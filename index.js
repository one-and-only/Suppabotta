import { createServer as httpsServer } from "https";
import { Server as socketIoServer } from "socket.io";
import { } from "dotenv/config";
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
// import { hash as passwordHash, verify as verifyPassword } from "argon2";
import express from "express";
import { promisify } from "util";
import Logger from './Logger.js';

const sleep = promisify(setTimeout);

import TradeOgre from "./providers/TradeOgre.js";
import SouthXChange from "./providers/SouthXChange.js";
import CoinEx from "./providers/CoinEx.js";
import DexTrade from "./providers/DexTrade.js";
import P2BExchange from "./providers/P2B.js";
// import Graviex from "./providers/Graviex.js";

import { Queue, Worker, QueueEvents } from "bullmq";
import { ExpressAdapter, createBullBoard, BullMQAdapter } from "@bull-board/express";
import IORedis from 'ioredis';

if (!process.env.LOG_FILE_PATH) {
    Logger.warning("Global", "startup", "No log file path specified. Logging to file will be disabled for this session.");
}

global.completedShutdown = false;
global.wantsShutdown = false;

const redisConnection = new IORedis(parseInt(process.env.REDIS_PORT), process.env.REDIS_HOST, { maxRetriesPerRequest: null });

const userQueue = new Queue("userQueue", { connection: redisConnection });
const queueEvents = new QueueEvents("userQueue", { connection: redisConnection });
const userWorker = new Worker("userQueue", async job => {
    while (true) {
        await sleep(250);
        if (global.wantsShutdown) break;
    }
}, { connection: redisConnection });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/queue_info");

const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues: [new BullMQAdapter(userQueue)],
    serverAdapter: serverAdapter,
});

queueEvents.on('drained', ({ jobId, returnvalue }) => {
    console.log("Queue now empty, assuming shutdown.");
    if (global.wantsShutdown)
        // TODO put shutdown logic here
        global.completedShutdown = true;
});

await userQueue.add("testJob", { foo: "bar" });

const mongoClient = new MongoClient(`mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@${process.env.MONGODB_ADDRESS}?authMechanism=DEFAULT`);
await mongoClient.connect();

const sampleUserData = await mongoClient.db("ArbitrageBot").collection("Users").findOne({
    username: "Revvz"
});

const TradeOgreInstance = await (new TradeOgre(sampleUserData.apiCreds.tradeogre.secret, sampleUserData.apiCreds.tradeogre.key)).initialize();
Logger.success("TradeOgre", "initialize", "Initialized successfully");
const SouthXChangeInstance = new SouthXChange(sampleUserData.apiCreds.southx.secret, sampleUserData.apiCreds.southx.key);
Logger.success("SouthXChange", "initialize", "Initialized successfully");
const DexTradeInstance = await (new DexTrade(sampleUserData.apiCreds.dextrade.secret, sampleUserData.apiCreds.dextrade.key)).initialize();
Logger.success("Dex-Trade", "initialize", "Initialized successfully");
const CoinExInstance = await (new CoinEx(sampleUserData.apiCreds.coinex.secret, sampleUserData.apiCreds.coinex.key)).initialize();
Logger.success("CoinEx", "initialize", "Initialized successfully");
// const GraviexInstance = await (new Graviex(sampleUserData.apiCreds.graviex.secret, sampleUserData.apiCreds.graviex.key)).initialize();
// Logger.success("Graviex", "initialize", "Initialized successfully");
const P2BInstance = await (new P2BExchange(sampleUserData.apiCreds.p2b.secret, sampleUserData.apiCreds.p2b.key)).initialize();
Logger.success("P2B", "initialize", "Initialized successfully");

const socketServer = httpsServer({
    key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH),
});

const app = express();
app.use("/queue_info", serverAdapter.getRouter(), (req, res) => {
    res.send();
});
app.get("/", (req, res) => {
    res.send("Main interface would normally be here.");
})

const expressServer = httpsServer({
    key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH),
}, app);
expressServer.listen(process.env.EXPRESS_PORT, () => {
    Logger.success("Global", "expressInit", `Express server is initialized and running on port ${process.env.EXPRESS_PORT}`);
});

const socketIoInstance = new socketIoServer(socketServer);

socketIoInstance.on("connection", (socket) => {
    console.log("connected!");
});

socketIoInstance.listen(2443);

// catch Ctrl-C and clean up
process.on("SIGINT", async () => {
    global.wantsShutdown = true;
    console.log("\nExit signal received. Cleaning up...");
    await mongoClient.close();
    socketIoInstance.close();
    socketServer.close();
    expressServer.close();
    console.log("Shut down servers");
    console.log("waiting for trading queue to drain...");
    while (!global.completedShutdown) {
        await sleep(500);
    }
    await userQueue.close();
    await userWorker.close();
    await queueEvents.close();
    console.log("\nCleaned up, goodbye!");
    process.exit(0);
});
