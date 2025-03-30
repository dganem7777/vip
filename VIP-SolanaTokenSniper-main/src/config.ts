export const config = {
  grpc_programs: {
    pumpfun: {
      program_id: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      discriminator: Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]),
    },
    pumpswap: {
      program_id: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      discriminator: "Program log: Instruction: CreatePool",
    },
  },
  liquidity_pool: [
    {
      enabled: true,
      id: "pump1",
      name: "pumpswap",
      program: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      instruction: "Program log: Instruction: CreatePool",
    },
    {
      enabled: false,
      id: "rad1",
      name: "Raydium",
      program: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
      instruction: "Program log: initialize2: InitializeInstruction2",
    },
  ],
  concurrent_transactions: 1, // Number of simultaneous transactions
  wsol_pc_mint: "So11111111111111111111111111111111111111112",
  db: {
    pathname: "src/tracker/tokens.db", // Sqlite Database location
  },
  token_stream: {
    mode: "grpc", // wss=WebSocket, grpc=gRPC
  },
  token_buy: {
    provider: "sniperoo",
    sol_amount: 0.2, // Amount of SOL to spend
    play_sound: true, // Works only on windows
    play_sound_text: "Order Filled!",
  },
  token_sell: {
    enabled: true, // If set to true, the bot will sell the token via Sniperoo API
    stop_loss_percent: 15,
    take_profit_percent: 50,
  },
  checks: {
    simulation_mode: false,
    mode: "none", // snipe=Minimal Checks, pumpdump=Check if older dan 1 min,full=Full Checks based on Rug Check, none=No Checks
    verbose_logs: false,
    settings: {
      // Dangerous (Checked in snipe mode)
      allow_mint_authority: false, // The mint authority is the address that has permission to mint (create) new tokens. Strongly Advised to set to false.
      allow_freeze_authority: false, // The freeze authority is the address that can freeze token transfers, effectively locking up funds. Strongly Advised to set to false
      // Critical
      max_alowed_pct_topholders: 50, // Max allowed percentage an individual topholder might hold
      exclude_lp_from_topholders: true, // If true, Liquidity Pools will not be seen as top holders
      block_returning_token_names: true,
      block_returning_token_creators: true,
      allow_insider_topholders: false, // Allow inseder accounts to be part of the topholders
      allow_not_initialized: false, // This indicates whether the token account is properly set up on the blockchain. Strongly Advised to set to false
      allow_rugged: false,
      allow_mutable: false,
      block_symbols: ["XXX"],
      block_names: ["XXX"],
      // Warning
      min_total_lp_providers: 999,
      min_total_markets: 999,
      min_total_market_Liquidity: 5000,
      // Misc
      ignore_ends_with_pump: true,
      max_score: 1, // Set to 0 to ignore
    },
  },
  axios: {
    get_timeout: 10000, // Timeout for API requests
  },
};
