import { exec } from "child_process";
import { config } from "../config";

export function playSound(speech?: string) {
  const text = speech ? speech : config.token_buy.play_sound_text;
  const command = `powershell -Command "(New-Object -com SAPI.SpVoice).speak('${text}')"`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return false;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return false;
    }
    console.log("🔔 [Notifications] User successfully notified");
    return true;
  });
}
