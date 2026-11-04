// Password stays off command-line arguments and shell history. Input is hidden on a TTY.
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { stdin, stdout } from "node:process";
if (!stdin.isTTY) throw new Error("Run interactively in a terminal.");
stdout.write("New password (at least 4 characters): ");
stdin.setRawMode(true);
stdin.resume();
let password = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
  for (const char of chunk) {
    if (char === "\u0003") {
      stdout.write("\n");
      process.exit(1);
    }
    if (char === "\r" || char === "\n") {
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (password.length < 4) {
        console.error("Use at least 4 characters.");
        process.exit(1);
      }
      const salt = randomBytes(24).toString("hex"),
        rounds = 100000;
      console.log(
        `pbkdf2$${rounds}$${salt}$${pbkdf2Sync(password, salt, rounds, 32, "sha256").toString("hex")}`,
      );
      process.exit(0);
    }
    if (char === "\u007f") password = password.slice(0, -1);
    else password += char;
  }
});
