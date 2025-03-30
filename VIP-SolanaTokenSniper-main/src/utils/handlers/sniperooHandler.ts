import axios from "axios";
import { validateEnv } from "../env-validator";

/**
 * Buys a token using the Sniperoo API
 * @param tokenAddress The token's mint address
 * @param inputAmount Amount of SOL to spend
 * @returns Boolean indicating if the purchase was successful
 */
export async function buyToken(tokenAddress: string, inputAmount: number, sell: boolean, tp: number, sl: number): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 200;
  const env = validateEnv();

  // Helper function to attempt the API call
  async function attemptBuyToken(retryCount: number): Promise<boolean> {
    try {
      // Validate inputs
      if (!tokenAddress || typeof tokenAddress !== "string" || tokenAddress.trim() === "") {
        return false;
      }

      if (inputAmount <= 0) {
        return false;
      }

      if (!tp || !sl) {
        sell = false;
      }

      // Prepare request body
      const requestBody = {
        walletAddresses: [env.SNIPEROO_PUBKEY],
        tokenAddress: tokenAddress,
        inputAmount: inputAmount,
        autoSell: {
          enabled: sell,
          strategy: {
            strategyName: "simple",
            profitPercentage: tp,
            stopLossPercentage: sl,
          },
        },
      };

      // Make API request using axios
      const response = await axios.post("https://api.sniperoo.app/trading/buy-token?toastFrontendId=0", requestBody, {
        headers: {
          Authorization: `Bearer ${env.SNIPEROO_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      // Axios automatically throws an error for non-2xx responses,
      // so if we get here, the request was successful
      return true;
    } catch (error) {
      // Check if it's the specific error we want to retry
      if (
        axios.isAxiosError(error) &&
        error.response?.status === 400 &&
        error.response?.data?.code_error === "INTERNAL_SERVER_ERROR" &&
        error.response?.data?.message?.includes("Transaction failed due to an unknown reason")
      ) {
        // If we haven't exceeded max retries, try again
        if (retryCount < MAX_RETRIES) {
          console.log(`🤞 [Sniper Handler] Snipe retry attempt ${retryCount + 1}/${MAX_RETRIES}`);
          // Wait for the specified delay
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          // Recursive call with incremented retry count
          return attemptBuyToken(retryCount + 1);
        }
      }

      // Handle axios errors
      if (axios.isAxiosError(error)) {
        console.error(`Sniperoo API error (${error.response?.status || "unknown"}):`, error.response?.data || error.message);
      } else {
        console.error("Error buying token:", error instanceof Error ? error.message : "Unknown error");
      }
      return false;
    }
  }

  // Start with retry count 0
  return attemptBuyToken(0);
}
