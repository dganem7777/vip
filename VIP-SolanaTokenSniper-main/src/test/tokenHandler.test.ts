import { isQuickRugPull } from "../utils/handlers/tokenHandler";

(async () => {
  const testId = "EUdQbKfHucJe99GVt3HQMUZCQtWtvXFyjvrqDWctpump";
  if (testId) {
    const res = await isQuickRugPull(testId);
    console.log("result:", res);
  }
})();
