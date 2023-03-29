import { createServer as httpsServer } from "https";
import { } from "dotenv/config";
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
import { verify as verifyPassword } from "argon2";
import express from "express";
import { promisify } from "util";
import Logger from "./Logger.js";

const sleep = promisify(setTimeout);

import TradeOgre from "./providers/TradeOgre.js";
import SouthXChange from "./providers/SouthXChange.js";
import CoinEx from "./providers/CoinEx.js";
// import DexTrade from "./providers/DexTrade.js";
import TxBit from "./providers/TxBit.js";
import Xeggex from "./providers/Xeggex.js";

import { Queue, Worker, QueueEvents } from "bullmq";
import { ExpressAdapter, createBullBoard, BullMQAdapter } from "@bull-board/express";
import IORedis from "ioredis";

import TickerMaintenanceStrategy from "./strategies/TickerMaintenance.js";
import ClassicArbitrageStrategy from "./strategies/ClassicArbitrage.js";
import FloatingArbitrageStrategy from "./strategies/ClassicArbitrage.js";

const strategyMaps = {
    "TickerMaintenance": {
        providers: [/*DexTrade,*/ TxBit],
        strategyClass: TickerMaintenanceStrategy
    },
    "ClassicArbitrage": {
        providers: [TradeOgre, SouthXChange, CoinEx, /*DexTrade,*/ TxBit, Xeggex],
        strategyClass: ClassicArbitrageStrategy
    },
    "FloatingArbitrage": {
        providers: [TradeOgre, SouthXChange, CoinEx, /*DexTrade,*/ TxBit, Xeggex],
        strategyClass: FloatingArbitrageStrategy
    }
};

if (!process.env.LOG_FILE_PATH) {
    Logger.warning("Global", "startup", "No log file path specified. Logging to file will be disabled for this session.");
}

global.doingTickerMaintenance = false;

const redisConnection = new IORedis(parseInt(process.env.REDIS_PORT), process.env.REDIS_HOST, { maxRetriesPerRequest: null });

const userQueueData = {};

const userQueue = new Queue("userQueue", { connection: redisConnection });
const queueEvents = new QueueEvents("userQueue", { connection: redisConnection });
const userWorker = new Worker("userQueue", async job => {
    const strategyData = userQueueData[job.data.username];
    const tickSpeed = job.data.strategyArgs?.tickSpeed ?? 10000;

    const strategyClass = new strategyData.strategyClass(strategyData.providers);

    await strategyClass.start();
    while (true) {
        if (userQueueData[job.data.username].wantsShutdown) {
            await strategyClass.shutdown();
            delete userQueueData[job.data.username];
            break;
        }
        await strategyClass.tick();
        await sleep(tickSpeed);
    }
}, { connection: redisConnection });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/queue_info");

createBullBoard({
    queues: [new BullMQAdapter(userQueue)],
    serverAdapter: serverAdapter,
});

const mongoClient = new MongoClient(`mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@${process.env.MONGODB_ADDRESS}?authMechanism=DEFAULT`);
await mongoClient.connect();

const app = express();
app.use("/queue_info", serverAdapter.getRouter(), (req, res) => {
    res.send();
});

app.get("/", (req, res) => {
    res.send("Main interface would normally be here.");
});

app.post("/startTrading", async (req, res) => {
    if (!req.query.username || !req.query.password || !req.query.strategy) {
        res.status(400).json({
            "success": false,
            "error": "one of username, password, or strategy missing"
        });
        return;
    }

    const userInfo = await mongoClient.db("ArbitrageBot").collection("Users").findOne({
        username: req.query.username
    });

    if (!userInfo) {
        res.status(400).json({
            "success": false,
            "error": "Invalid username"
        });
        return;
    }

    if (!(await verifyPassword(userInfo.password, req.query.password))) {
        res.status(400).json({
            success: false,
            error: "Invalid password"
        });
        return;
    }

    if (req.query.strategy === "TickerMaintenance") {
        if (global.doingTickerMaintenance) {
            res.status(400).json({
                success: false,
                error: "In order to prevent volume pumping, only one TickerMaintenance strategy may run at the same time. Cancel the running TickerMaintenance strategy and try again."
            });
            return;
        }
        global.doingTickerMaintenance = true;
    }

    if (!strategyMaps[req.query.strategy]) {
        res.status(400).json({
            success: false,
            error: "Invalid trading strategy"
        });
        return;
    }

    const strategyInfo = strategyMaps[req.query.strategy];
    userQueueData[req.query.username] = {
        providers: [],
        strategyClass: strategyInfo.strategyClass,
        wantsShutdown: false
    };

    for (const providerClass of strategyInfo.providers) {
        const providerCreds = userInfo.apiCreds[providerClass.name.toLowerCase()];
        const provider = await new providerClass(providerCreds.secret, providerCreds.key).initialize();
        userQueueData[req.query.username].providers.push(provider);
    }

    await userQueue.add(req.query.username, { username: req.query.username, strategyArgs: req.query.args ? JSON.parse(req.query.args) : null });

    res.json({
        success: true,
        message: "Job added to queue"
    });
});

const expressServer = httpsServer({
    key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH),
}, app);
expressServer.listen(process.env.EXPRESS_PORT, () => {
    Logger.success("Global", "expressInit", `Express server is initialized and running on port ${process.env.EXPRESS_PORT}`);
});

let shutdownTries = 0;
// catch Ctrl-C and clean up
process.on("SIGINT", async () => {
    shutdownTries++;
    (shutdownTries > 0) && (shutdownTries % 2 === 0) && process.exit(1);
    shutdownTries % 2 === 1 && Logger.info("Global", "forcedShutdown", "Shutting down. CTRL + C one more time to force shutdown!");

    Logger.info("Global", "shutdown", "Exit signal received. Cleaning up...");

    for (const username in userQueueData) {
        userQueueData[username].wantsShutdown = true;
    }

    expressServer.close();
    await mongoClient.close();
    Logger.info("Global", "shutdown", "Servers are off");
    Logger.info("Global", "shutdown", "waiting for trading queue to drain...");

    let numJobsLeft = (await userQueue.getJobs("active")).length;
    while (numJobsLeft > 0) {
        Logger.info("Global", "shutdown", `${numJobsLeft} job${numJobsLeft > 1 ? "s" : ""} left to drain.`);
        await sleep(1000);
        numJobsLeft = (await userQueue.getJobs("active")).length;
    }

    Logger.info("Global", "shutdown", "Trading queue drained");

    await userWorker.close();
    await queueEvents.close();
    await userQueue.close();
    console.log("\nCleaned up, goodbye!");
    process.exit(0);
});
