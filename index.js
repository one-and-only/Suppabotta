import { createServer as httpsServer } from "https";
import { Server as socketIoServer } from "socket.io";
import { } from "dotenv/config";
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
// import { hash as passwordHash, verify as verifyPassword } from "argon2";
import basicAuth from "express-basic-auth";
import auth from "basic-auth";
import express from "express";
import { promisify } from "util";

const sleep = promisify(setTimeout);

import TradeOgre from "./providers/TradeOgre.js";
import SouthXChange from "./providers/SouthXChange.js";
import CoinEx from "./providers/CoinEx.js";
import DexTrade from "./providers/DexTrade.js";

import { Queue, Worker, QueueEvents } from "bullmq";
import { ExpressAdapter, createBullBoard, BullAdapter, BullMQAdapter } from "@bull-board/express";
import IORedis from 'ioredis';

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
        global.completedShutdown = true;
});

await userQueue.add("testJob", { foo: "bar" });

const mongoClient = new MongoClient(`mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@${process.env.MONGODB_ADDRESS}?authMechanism=DEFAULT`);
await mongoClient.connect();

const sampleUserData = await mongoClient.db("ArbitrageBot").collection("Users").findOne({
    username: "Revvz"
});

const TradeOgreInstance = await (new TradeOgre(sampleUserData.apiCreds.tradeogre.secret, sampleUserData.apiCreds.tradeogre.key)).initialize();
// const SouthXChangeInstance = new SouthXChange(sampleUserData.apiCreds.southx.secret, sampleUserData.apiCreds.southx.key);

const socketServer = httpsServer({
    key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH),
});

const app = express();
app.use(basicAuth({
    challenge: true,
    users: { 'admin': 'admin' }
}));
app.use("/queue_info", serverAdapter.getRouter(), (req, res) => {
    const user = auth(req);
    if (user.name !== "admin" || user.pass !== "admin") {
        res.send("Invalid username or password");
        return;
    }
    res.send("Welcome! Currently empty");
});
app.get("/", (req, res) => {
    res.send("Main interface would normally be here.");
})

const expressServer = httpsServer({
    key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH),
}, app);
expressServer.listen(process.env.EXPRESS_PORT, () => {
    console.log(`Express server is running on port ${process.env.EXPRESS_PORT}`);
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
