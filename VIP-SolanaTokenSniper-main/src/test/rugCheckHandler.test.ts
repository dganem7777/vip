import { getRugCheckConfirmed } from "../utils/handlers/rugCheckHandler";

(async () => {
  const testId = "";
  if (testId) {
    const res = await getRugCheckConfirmed(testId);
    console.log("result:", res);
  }
})();
