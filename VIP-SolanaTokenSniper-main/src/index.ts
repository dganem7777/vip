import WebSocket from "ws"; // Node.js websocket library
import Client, { SubscribeRequest, SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { ClientDuplexStream } from "@grpc/grpc-js";
import { config } from "./config"; // Configuration parameters for our bot
import { validateEnv } from "./utils/env-validator";
import { WebSocketManager, ConnectionState } from "./utils/managers/websocketManager";
import { getMintFromSignature } from "./utils/handlers/signatureHandler";
import { getTokenAuthorities, isQuickRugPull, TokenAuthorityStatus } from "./utils/handlers/tokenHandler";
import { buyToken } from "./utils/handlers/sniperooHandler";
import { getRugCheckConfirmed } from "./utils/handlers/rugCheckHandler";
import { playSound } from "./utils/notification";
import { createSubscribeRequest, isSubscribeUpdateTransaction, sendSubscribeRequest } from "./utils/managers/grpcManager";
import { format } from "date-fns";

/**
 *  Load environment variables from the .env file
 */
const env = validateEnv();

/**
 * Global Variables for the application
 */
let activeTransactions = 0;
const MAX_CONCURRENT = config.concurrent_transactions;
const CHECK_MODE = config.checks.mode || "full";
const STREAM_MODE = config.token_stream.mode || "wss";
const WSS_SUBSCRIBE_LP = config.liquidity_pool;
const GRPC_SUBSCRIBE_PROGRAMS = {
  programIds: [config.grpc_programs.pumpswap.program_id],
  instructionDiscriminators: [config.grpc_programs.pumpswap.discriminator],
};

/**
 * Global Variables for buying and selling
 */
const BUY_PROVIDER = config.token_buy.provider;
const BUY_AMOUNT = config.token_buy.sol_amount;
const SELL_ENABLED = config.token_sell.enabled || false;
const SELL_STOP_LOSS = config.token_sell.stop_loss_percent || 15;
const SELL_TAKE_PROFIT = config.token_sell.take_profit_percent || 50;
const SIM_MODE = config.checks.simulation_mode || false;
const PLAY_SOUND = config.token_buy.play_sound || false;

// current handled mint
const WSOL_MINT = config.wsol_pc_mint;
let CURRENT_MINT: string = "";

/**
 *  Function to start the websocket listener
 */
async function startWebSocketListener(): Promise<void> {
  console.clear();
  console.log("🚀 Starting Solana Token Sniper via Websocket...");

  // Create WebSocket manager
  const wsManager = new WebSocketManager({
    url: env.HELIUS_WSS_URI,
    initialBackoff: 1000,
    maxBackoff: 30000,
    maxRetries: Infinity,
    debug: true,
  });

  // Set up event handlers
  wsManager.on("open", () => {
    /**
     * Create a new subscription request for each program ID
     */
    WSS_SUBSCRIBE_LP.filter((pool) => pool.enabled).forEach((pool) => {
      const subscriptionMessage = {
        jsonrpc: "2.0",
        id: pool.id,
        method: "logsSubscribe",
        params: [
          {
            mentions: [pool.program],
          },
          {
            commitment: "processed", // Can use finalized to be more accurate.
          },
        ],
      };
      wsManager.send(JSON.stringify(subscriptionMessage));
    });
  });

  wsManager.on("message", async (data: WebSocket.Data) => {
    try {
      const jsonString = data.toString(); // Convert data to a string
      const parsedData = JSON.parse(jsonString); // Parse the JSON string

      // Handle subscription response
      if (parsedData.result !== undefined && !parsedData.error) {
        console.log("✅ Websocket Subscription confirmed");
        return;
      }

      // Only log RPC errors for debugging
      if (parsedData.error) {
        console.error("🚫 RPC Error:", parsedData.error);
        return;
      }

      // Safely access the nested structure
      const logs = parsedData?.params?.result?.value?.logs;
      const signature = parsedData?.params?.result?.value?.signature;

      // Validate `logs` is an array and if we have a signtature
      if (!Array.isArray(logs) || !signature) return;

      // Verify if this is a new pool creation
      const liquidityPoolInstructions = WSS_SUBSCRIBE_LP.filter((pool) => pool.enabled).map((pool) => pool.instruction);
      const containsCreate = logs.some((log: string) => typeof log === "string" && liquidityPoolInstructions.some((instruction) => log.includes(instruction)));

      if (!containsCreate || typeof signature !== "string") return;

      // Verify if we have reached the max concurrent transactions
      if (activeTransactions >= MAX_CONCURRENT) {
        console.log("⏳ Max concurrent transactions reached, skipping...");
        return;
      }

      // Add additional concurrent transaction
      activeTransactions++;

      // Process transaction asynchronously
      processWebsocketSignature(signature)
        .catch((error) => {
          console.error("Error processing transaction:", error);
        })
        .finally(() => {
          activeTransactions--;
        });
    } catch (error) {
      console.error("💥 Error processing message:", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  wsManager.on("error", (error: Error) => {
    console.error("WebSocket error:", error.message);
  });

  wsManager.on("state_change", (state: ConnectionState) => {
    if (state === ConnectionState.RECONNECTING) {
      console.log("📴 WebSocket connection lost, attempting to reconnect...");
    } else if (state === ConnectionState.CONNECTED) {
      console.log("🔄 WebSocket reconnected successfully.");
    }
  });

  // Start the connection
  wsManager.connect();

  // Handle application shutdown
  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down...");
    wsManager.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Shutting down...");
    wsManager.disconnect();
    process.exit(0);
  });
}
async function processWebsocketSignature(signature: string): Promise<void> {
  console.log("================================================================");
  console.log("💦 [Process Transaction] New Liquidity Pool signature found");
  console.log("⌛ [Process Transaction] Extracting token CA from signature...");
  console.log("https://solscan.io/tx/" + signature);

  /**
   * Extract the token CA from the transaction signature
   */
  const returnedMint = await getMintFromSignature(signature);
  if (!returnedMint) {
    console.log("❌ [Process Transaction] No valid token CA could be extracted");
    console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
    return;
  }
  console.log("✅ [Process Transaction] Token CA extracted successfully");

  /**
   * Check if the mint address is the same as the current one to prevent failed logs from spam buying
   */
  if (CURRENT_MINT === returnedMint) {
    console.log("⏭️ [Process Transaction] Skipping duplicate mint to prevent mint spamming");
    console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
    return;
  }
  CURRENT_MINT = returnedMint;

  /**
   * Perform checks based on selected level of rug check
   */
  if (CHECK_MODE === "snipe") {
    console.log(`🔍 [Process Transaction] Performing ${CHECK_MODE} check`);
    const tokenAuthorityStatus: TokenAuthorityStatus = await getTokenAuthorities(returnedMint);
    if (!tokenAuthorityStatus.isSecure) {
      /**
       * Token is not secure, check if we should skip based on preferences
       */
      const allowMintAuthority = config.checks.settings.allow_mint_authority || false;
      const allowFreezeAuthority = config.checks.settings.allow_freeze_authority || false;
      if (!allowMintAuthority && tokenAuthorityStatus.hasMintAuthority) {
        console.log("❌ [Process Transaction] Token has mint authority, skipping...");
        console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
        return;
      }
      if (!allowFreezeAuthority && tokenAuthorityStatus.hasFreezeAuthority) {
        console.log("❌ [Process Transaction] Token has freeze authority, skipping...");
        console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
        return;
      }
    }
    console.log("✅ [Process Transaction] Snipe check passed successfully");
  } else if (CHECK_MODE === "full") {
    /**
     *  Perform full check
     */
    if (returnedMint.trim().toLowerCase().endsWith("pump") && config.checks.settings.ignore_ends_with_pump) {
      console.log("❌ [Process Transaction] Token ends with pump, skipping...");
      console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
      return;
    }
    // Check rug check
    const isRugCheckPassed = await getRugCheckConfirmed(returnedMint);
    if (!isRugCheckPassed) {
      console.log("❌ [Process Transaction] Full rug check not passed, skipping...");
      console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
      return;
    }
  }

  /**
   * Perform Swap Transaction
   */
  if (BUY_PROVIDER === "sniperoo" && !SIM_MODE) {
    console.log("🔫 [Process Transaction] Sniping token using Sniperoo...");
    const result = await buyToken(returnedMint, BUY_AMOUNT, SELL_ENABLED, SELL_TAKE_PROFIT, SELL_STOP_LOSS);
    if (!result) {
      CURRENT_MINT = ""; // Reset the current mint
      console.log("❌ [Process Transaction] Token not swapped. Sniperoo failed.");
      console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
      return;
    }
    if (PLAY_SOUND) playSound();
    console.log("✅ [Process Transaction] Token swapped successfully using Sniperoo");
  }

  /**
   * Check if Simopulation Mode is enabled in order to output the warning
   */
  if (SIM_MODE) {
    console.log("🧻 [Process Transaction] Token not swapped! Simulation Mode turned on.");
    if (PLAY_SOUND) playSound("Token found in simulation mode");
  }

  /**
   * Output token mint address
   */
  const now = new Date();
  const date = format(now, "yyyy-MM-dd HH:mm:ss"); // Example: "2025-03-28 14:30:45"
  console.log("Token Sniped:", date);
  console.log("👽 GMGN: https://gmgn.ai/sol/token/" + returnedMint);
  console.log("😈 BullX: https://neo.bullx.io/terminal?chainId=1399811149&address=" + returnedMint);
}

/**
 * Function to start the gRPC listener
 */
async function startGrpcListener(): Promise<void> {
  console.clear();
  console.log("🚀 Starting Solana Token Sniper via gRPC...");

  const gClient = new Client(env.SVS_GRPC_HTTP, "", { skipPreflight: true });
  // Create a subscription stream.
  const gStream = await gClient.subscribe();
  const request = createSubscribeRequest(GRPC_SUBSCRIBE_PROGRAMS.programIds);

  try {
    await sendSubscribeRequest(gStream, request);
    console.log("✅ Geyser connection and subscription established\n");
    await handleGrpcStates(gStream);
  } catch (error) {
    console.error("❌ Error in subscription process:", error);
    gStream.end();
  }
}
function handleGrpcStates(stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.on("data", processGrpcData);
    stream.on("error", (error: Error) => {
      console.error("Stream error:", error);
      reject(error);
      stream.end();
    });
    stream.on("end", () => {
      console.log("Stream ended");
      resolve();
    });
    stream.on("close", () => {
      console.log("Stream closed");
      resolve();
    });
  });
}
async function processGrpcData(data: SubscribeUpdate): Promise<void> {
  if (!isSubscribeUpdateTransaction(data) || !data.filters.includes("pumpswap")) {
    return;
  }

  const transaction = data.transaction?.transaction;
  const meta = transaction?.meta;

  if (!transaction || !meta) {
    return;
  }

  // if (!transaction.meta?.logMessages.includes("Program log: Instruction: CreatePool")) {
  //   return;
  // }
  if (!meta.logMessages?.some((log) => log.includes("CreatePool"))) {
    return;
  }

  console.log("================================================================");
  console.log("💦 [Process gRPC update] New Liquidity Pool signature found");
  console.log("⌛ [Process gRPC update] Extracting token CA from signature...");

  /**
   * Extract the token CA from the meta
   */
  const tokenBalances = meta.postTokenBalances || meta.preTokenBalances;
  if (!tokenBalances?.length) return;

  const tokenMint = getMintFromTokenBalances(tokenBalances);
  if (!tokenMint) {
    console.log("❌ [Process gRPC update] No valid token CA could be extracted");
    console.log("🔎 [Process gRPC update] Looking for new Liquidity Pools again\n");
    return;
  }
  console.log("✅ [Process gRPC update] Token CA extracted successfully");
  await processGrpcMint(tokenMint);
}
function getMintFromTokenBalances(tokenBalances: any): string | null {
  // Fast path: If we have exactly 2 token balances, one is likely WSOL and the other is the token
  if (tokenBalances.length === 2) {
    const mint1 = tokenBalances[0].mint;
    const mint2 = tokenBalances[1].mint;

    // If mint1 is WSOL, return mint2 (unless it's also WSOL)
    if (mint1 === WSOL_MINT) {
      return mint2 === WSOL_MINT ? null : mint2;
    }

    // If mint2 is WSOL, return mint1
    if (mint2 === WSOL_MINT) {
      return mint1;
    }

    // If neither is WSOL, return the first one
    return mint1;
  }

  // For more than 2 balances, find the first non-WSOL mint
  for (const balance of tokenBalances) {
    if (balance.mint !== WSOL_MINT) {
      return balance.mint;
    }
  }
  return null;
}
async function processGrpcMint(returnedMint: string): Promise<void> {
  /**
   * Check if the mint address is the same as the current one to prevent failed logs from spam buying
   */
  if (CURRENT_MINT === returnedMint) {
    console.log("⏭️ [Process Transaction] Skipping duplicate mint to prevent mint spamming");
    console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
    return;
  }
  CURRENT_MINT = returnedMint;

  /**
   * Perform checks based on selected level of rug check
   */
  if (CHECK_MODE === "snipe") {
    console.log(`🔍 [Process Transaction] Performing ${CHECK_MODE} check`);
    const tokenAuthorityStatus: TokenAuthorityStatus = await getTokenAuthorities(returnedMint);
    if (!tokenAuthorityStatus.isSecure) {
      /**
       * Token is not secure, check if we should skip based on preferences
       */
      const allowMintAuthority = config.checks.settings.allow_mint_authority || false;
      const allowFreezeAuthority = config.checks.settings.allow_freeze_authority || false;
      if (!allowMintAuthority && tokenAuthorityStatus.hasMintAuthority) {
        console.log("❌ [Process Transaction] Token has mint authority, skipping...");
        console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
        return;
      }
      if (!allowFreezeAuthority && tokenAuthorityStatus.hasFreezeAuthority) {
        console.log("❌ [Process Transaction] Token has freeze authority, skipping...");
        console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
        return;
      }
    }
    console.log("✅ [Process Transaction] Snipe check passed successfully");
  } else if (CHECK_MODE === "pumpdump") {
    // Check dev check
    const isDevCheckPassed = await isQuickRugPull(returnedMint);
    if (!isDevCheckPassed) {
      console.log("❌ [Process Transaction] Dev rug check not passed, skipping...");
      console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
      return;
    }
  } else if (CHECK_MODE === "full") {
    /**
     *  Perform full check
     */
    if (returnedMint.trim().toLowerCase().endsWith("pump") && config.checks.settings.ignore_ends_with_pump) {
      console.log("❌ [Process Transaction] Token ends with pump, skipping...");
      console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
      return;
    }
    // Check rug check
    const isRugCheckPassed = await getRugCheckConfirmed(returnedMint);
    if (!isRugCheckPassed) {
      console.log("❌ [Process Transaction] Full rug check not passed, skipping...");
      console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
      return;
    }
  }

  /**
   * Perform Swap Transaction
   */
  if (BUY_PROVIDER === "sniperoo" && !SIM_MODE) {
    console.log("🔫 [Process Transaction] Sniping token using Sniperoo...");
    const result = await buyToken(returnedMint, BUY_AMOUNT, SELL_ENABLED, SELL_TAKE_PROFIT, SELL_STOP_LOSS);
    if (!result) {
      CURRENT_MINT = ""; // Reset the current mint
      console.log("❌ [Process Transaction] Token not swapped. Sniperoo failed.");
      console.log("🔎 [Process Transaction] Looking for new Liquidity Pools again\n");
      return;
    }
    if (PLAY_SOUND) playSound();
    console.log("✅ [Process Transaction] Token swapped successfully using Sniperoo");
  }

  /**
   * Check if Simopulation Mode is enabled in order to output the warning
   */
  if (SIM_MODE) {
    console.log("🧻 [Process Transaction] Token not swapped! Simulation Mode turned on.");
    if (PLAY_SOUND) playSound("Token found in simulation mode");
  }

  /**
   * Output token mint address
   */
  const now = new Date();
  const date = format(now, "yyyy-MM-dd HH:mm:ss"); // Example: "2025-03-28 14:30:45"
  console.log("🚀 [Process Transaction] Token Sniped:", date);
  console.log("📜 [Process Transaction] CA:", returnedMint);
}

// Start the application
if (STREAM_MODE === "grpc") {
  startGrpcListener().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else if (STREAM_MODE === "wss") {
  startWebSocketListener().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else {
  console.log("🚫 Invalid stream mode selected. Please select either 'grpc' or 'wss' in your appliation config.");
  process.exit(1);
}
