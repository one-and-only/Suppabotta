// import { createServer as httpsServer } from "https";
// import { Server as socketIoServer } from "socket.io";
import { } from "dotenv/config";
// import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
import { hash as passwordHash, verify as verifyPassword } from "argon2";

import TradeOgre from "./providers/TradeOgre.js";
import SouthXChange from "./providers/SouthXChange.js";
import CoinEx from "./providers/CoinEx.js";
import DexTrade from "./providers/DexTrade.js";
import QTrade from "./providers/QTrade.js";

const mongoClient = new MongoClient(`mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@${process.env.MONGODB_ADDRESS}?authMechanism=DEFAULT`);
await mongoClient.connect();

const sampleUserData = await mongoClient.db("ArbitrageBot").collection("Users").findOne({
    username: "Revvz"
});
if (verifyPassword(sampleUserData.password, "Antonios12!")) {
    console.log("Password verified, welcome!");
} else {
    console.log("Invalid username or password, please try again.");
}

const TradeOgreInstance = new TradeOgre(sampleUserData.apiCreds.tradeogre.secret, sampleUserData.apiCreds.tradeogre.key);

console.log(await TradeOgreInstance.getMarketPrice("btc"));

// const webServer = httpsServer({
//   key: readFileSync(process.env.SSL_KEY_PATH),
//   cert: readFileSync(process.env.SSL_CERT_PATH)
// });
// const socketIoInstance = new socketIoServer(webServer);

// socketIoInstance.on("connection", (socket) => {
//   console.log("connected!");
// });

// socketIoInstance.listen(2443);

// catch Ctrl-C and clean up
process.on("SIGINT", async () => {
  console.log("\nExit signal received. Cleaning up...");
  await mongoClient.close();
  console.log("\nCleaned up, goodbye!");
  process.exit(0);
});
