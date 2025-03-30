import Client, { CommitmentLevel, SubscribeRequest, SubscribeUpdate, SubscribeUpdateTransaction } from "@triton-one/yellowstone-grpc";
import { ClientDuplexStream } from "@grpc/grpc-js";

/**
 * Creates a subscription request object for the gRPC server
 *
 * This function generates a properly formatted SubscribeRequest object that defines
 * what blockchain data the client wants to receive from the Solana gRPC server.
 *
 * @param accountInclude - An array of program IDs (as strings) that the client wants to monitor
 * @returns A SubscribeRequest object configured to listen for transactions involving the specified programs
 *
 * The returned request object includes:
 * 1. A filter named 'pumpFun' that watches for transactions involving the specified program IDs
 * 2. A commitment level set to CONFIRMED, ensuring transactions have been confirmed by the network
 * 3. Empty configurations for other potential subscription types (accounts, slots, etc.)
 *
 * This function is essential for setting up the initial subscription parameters
 * before establishing a connection with the gRPC server. It allows the client
 * to focus on specific program activities on the Solana blockchain rather than
 * receiving all blockchain data.
 */
export function createSubscribeRequest(accountInclude: string[]): SubscribeRequest {
  const COMMITMENT = CommitmentLevel.PROCESSED;
  return {
    accounts: {},
    slots: {},
    transactions: {
      pumpswap: {
        accountInclude: accountInclude,
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    commitment: COMMITMENT,
    accountsDataSlice: [],
    ping: undefined,
  };
}
/**
 * Sends a subscription request to the gRPC server and returns a Promise
 *
 * This function takes a gRPC stream and a subscription request, then writes the request
 * to the stream in an asynchronous manner. It wraps the callback-based stream.write()
 * method in a Promise to allow for easier async/await usage in the calling code.
 *
 * @param stream - The bidirectional gRPC stream used for communication with the server
 * @param request - The subscription request containing filter criteria for the data you want to receive
 * @returns A Promise that resolves when the write operation completes successfully, or rejects if an error occurs
 *
 * The function handles the following scenarios:
 * 1. Success: When the stream successfully writes the request, the Promise resolves
 * 2. Failure: When the stream encounters an error during writing, the Promise rejects with that error
 *
 * This Promise-based approach allows the calling code to use async/await syntax
 * instead of dealing with callbacks, making the code more readable and maintainable.
 */
export function sendSubscribeRequest(stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>, request: SubscribeRequest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.write(request, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
/**'
 * Returns if the data is a SubscribeUpdate object with a transaction property
 */
export function isSubscribeUpdateTransaction(data: SubscribeUpdate): data is SubscribeUpdate & { transaction: SubscribeUpdateTransaction } {
  return (
    "transaction" in data &&
    typeof data.transaction === "object" &&
    data.transaction !== null &&
    "slot" in data.transaction &&
    "transaction" in data.transaction
  );
}
