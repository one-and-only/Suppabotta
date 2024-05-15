import { createServer as createHttpsServer } from "https";
import { } from "dotenv/config";
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
import { verify as verifyPassword, hash as hashPassword } from "argon2";
import express from "express";
import * as socketIo from "socket.io";
import { promisify } from "util";
import Logger from "./Logger.js";
import RequestHelper from "./RequestHelper.js";

import IP from "ip";
const { address: ipAddress } = IP;

const sleep = promisify(setTimeout);

import TradeOgre from "./providers/TradeOgre.js";
import CoinEx from "./providers/CoinEx.js";
import DexTrade from "./providers/DexTrade.js";
import Xeggex from "./providers/Xeggex.js";
import NonKYC from "./providers/NonKYC.js";

import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";

import TickerMaintenanceStrategy from "./strategies/TickerMaintenance.js";
import ClassicArbitrageStrategy from "./strategies/ClassicArbitrage.js";
import FloatingArbitrageStrategy from "./strategies/FloatingArbitrage.js";
import { apiRateLimits } from "./APIRateLimits.js";

// TODO: Update all connectors to support custom outbound IP when using `RequestHelper`

const strategyMaps = {
    "TickerMaintenance": {
        providers: [DexTrade],
        strategyClass: TickerMaintenanceStrategy
    },
    "ClassicArbitrage": {
        providers: [TradeOgre, CoinEx, DexTrade, Xeggex, NonKYC],
        strategyClass: ClassicArbitrageStrategy
    },
    "FloatingArbitrage": {
        providers: [TradeOgre, CoinEx, DexTrade, Xeggex, NonKYC],
        strategyClass: FloatingArbitrageStrategy
    }
};

if (!process.env.LOG_FILE_PATH) {
    Logger.warning("Global", "startup", "No log file path specified. Logging to file will be disabled for this session.");
}

global.doingTickerMaintenance = false;

const redisConnection = new IORedis(parseInt(process.env.REDIS_PORT), process.env.REDIS_HOST, { maxRetriesPerRequest: null });

const mongoClient = new MongoClient(`mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@${process.env.MONGODB_ADDRESS}?authMechanism=DEFAULT`);
await mongoClient.connect();
const mongoDb = mongoClient.db(process.env.MONGODB_DATABASE);
const userCollection = mongoDb.collection("Users");

const userQueueData = {};

const userQueue = new Queue("userQueue", { connection: redisConnection });
const queueEvents = new QueueEvents("userQueue", { connection: redisConnection });
const userWorker = new Worker("userQueue", async job => {
    const strategyData = userQueueData[job.data.username][job.data.strategy];
    const strategyInstance = new strategyData.strategyClass(strategyData.providers, { ...(job.data.strategyArgs), socketBroadcaster: strategyData.socketBroadcaster }, mongoDb.collection(process.env.PAPER_TRADING_MONGO_DATABASE));
    strategyData.strategyInstance = strategyInstance;

    await strategyInstance.start();
    while (true) {
        if (userQueueData[job.data.username][job.data.strategy].wantsShutdown) {
            await strategyInstance.shutdown();
            delete userQueueData[job.data.username][job.data.strategy];
            break;
        }
        await strategyInstance.tick();
    }
}, { connection: redisConnection, concurrency: 9999 });

async function numJobsLeft() {
    return (await userQueue.getJobs("active")).length;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.static("static"));

app.get("/queue_info", async (req, res) => {
    res.json({
        tradingThreadsCount: await numJobsLeft(),
        failedCount: await userQueue.getFailedCount(),
        completedCount: await userQueue.getCompletedCount()
    });
});

app.post("/register", async (req, res) => {
    if (!req.body.username || !req.body.password) {
        res.status(400).json({
            success: false,
            error: "Username and/or password not provided"
        });
        return;
    }

    if (!req.body.exchangeCredentials) {
        res.status(400).json({
            success: false,
            error: "Exchange Credentials not provided"
        });
        return;
    } else if (Object.keys(req.body.exchangeCredentials).length < 1) {
        res.status(400).json({
            success: false,
            error: "Too few exchange credentials"
        });
        return;
    }

    if (await userCollection.findOne({ username: req.body.username })) {
        res.status(400).json({
            success: false,
            error: "User already exists"
        })
        return;
    }

    const passwordHash = await hashPassword(req.body.password);
    if (!(await userCollection.insertOne({
        username: req.body.username,
        password: passwordHash,
        apiCreds: req.body.exchangeCredentials
    })).acknowledged) {
        res.status(500).json({
            success: false,
            error: "Failed to save user to database"
        });
        return;
    }

    res.json({
        success: true,
        message: "Successfully registered"
    });
});

app.post("/stopTrading", async (req, res) => {
    if (!req.query.username || !req.query.password || !req.query.strategy) {
        res.status(400).json({
            success: false,
            error: "Username, password, or strategy not provided"
        });
        return;
    }

    if (!userQueueData[req.query.username]?.[req.query.strategy]) {
        res.status(400).json({
            success: false,
            error: "Trading thread does not exist for this user"
        });
        return;
    }

    const userInfo = await validLogin(req.query);

    if (!userInfo) {
        res.status(400).json({
            success: false,
            error: "Unauthorized to stop trading (invalid password)"
        });
        return;
    }

    userQueueData[req.query.username][req.query.strategy].wantsShutdown = true;
    while (true) {
        if (!userQueueData[req.query.username][req.query.strategy])
            break;

        await sleep(1000);
    }

    res.json({
        success: true,
        message: "Trading thread successfully stopped"
    });
});

async function validLogin(query) {
    if (!query.username || !query.password) return false;

    const userInfo = await userCollection.findOne({
        username: query.username
    });

    if (!userInfo) return false;

    if (!(await verifyPassword(userInfo.password, query.password))) return false;

    return userInfo;
}

app.get("/login", async (req, res) => {
    res.send({ result: await validLogin(req.query) });
});

app.post("/startTrading", async (req, res) => {
    const userInfo = await validLogin(req.query);

    if (!userInfo) {
        res.status(400).json({
            success: false,
            error: "Invalid username or password"
        });
        return;
    }

    if (!req.query.strategy) {
        res.status(400).json({
            success: false,
            error: "Trading strategy missing"
        });
        return;
    }

    if (req.query.strategy === "TickerMaintenance") {
        if (global.doingTickerMaintenance) {
            res.status(400).json({
                success: false,
                error: "In order to prevent volume pumping, only one TickerMaintenance strategy may run at the same time. Stop the running TickerMaintenance strategy and try again."
            });
            return;
        }
        global.doingTickerMaintenance = true;
    }

    const strategyInfo = strategyMaps[req.query.strategy];
    if (!strategyInfo) {
        res.status(400).json({
            success: false,
            error: "Invalid trading strategy"
        });
        return;
    }

    const tradingArgs = req.query.args ? JSON.parse(req.query.args) : {};

    // set our target IP address
    const outboundIp = tradingArgs.customLocalIp ?? ipAddress();

    if (!userQueueData.hasOwnProperty(req.query.username)) userQueueData[req.query.username] = {};

    if (!userQueueData[req.query.username].hasOwnProperty("requestHelpers")) {
        userQueueData[req.query.username].requestHelpers = {};
        userQueueData[req.query.username].requestHelpers.initialized = false;
    }

    userQueueData[req.query.username][req.query.strategy] = {
        providers: [],
        strategyClass: strategyInfo.strategyClass,
        socketBroadcaster: io.to(`${req.query.username}_${req.query.strategy}`),
        wantsShutdown: false
    };

    for (const providerClass of strategyInfo.providers) {
        const providerCreds = userInfo.apiCreds[providerClass.name.toLowerCase()];
        if (!providerCreds) continue;

        if (userQueueData[req.query.username].requestHelpers.initialized === false)
            userQueueData[req.query.username].requestHelpers[providerClass.name] = new RequestHelper(
                apiRateLimits[providerClass.name],
                !apiRateLimits[providerClass.name].hasOwnProperty("private"),
                outboundIp
            );

        const provider = await new providerClass(outboundIp, userQueueData[req.query.username].requestHelpers[providerClass.name], providerCreds.secret, providerCreds.key, tradingArgs.baseCurrency).initialize();
        userQueueData[req.query.username][req.query.strategy].providers.push(provider);
    }

    userQueueData[req.query.username].requestHelpers.initialized = true;

    await userQueue.add(req.query.username, { username: req.query.username, strategy: req.query.strategy, strategyArgs: tradingArgs });

    res.json({
        success: true,
        message: "Job added to queue"
    });
});

app.get("/pendingExchangeOrders", async (req, res) => {
    if (!req.query.username || !req.query.password || !req.query.strategy) {
        res.status(400).json({
            success: false,
            error: "One or more required parameters not provided"
        });
        return;
    }
    const userInfo = await validLogin(req.query);

    if (!userInfo) {
        res.status(400).json({
            success: false,
            error: "Invalid username or password"
        });
        return;
    }

    const queueData = userQueueData[req.query.username]?.[req.query.strategy];
    if (!queueData) {
        res.status(400).json({
            success: false,
            error: "Trading thread does not exist for this user"
        });
        return;
    }

    res.json(queueData.strategyInstance?.pendingTrades());
});

const expressServer = createHttpsServer({
    key: readFileSync(process.env.SSL_KEY_PATH),
    cert: readFileSync(process.env.SSL_CERT_PATH),
});
expressServer.on("request", app);

const io = new socketIo.Server(expressServer, {
    connectionStateRecovery: {
        maxDisconnectionDuration: 60 * 1000,
        skipMiddlewares: true,
    }
});

io.on("connection", socket => {
    socket.on("login as", metadata => {
        const split = metadata.split(',');
        socket.join(`${split[0]}_${split[1]}`);
    });
});

expressServer.listen(process.env.EXPRESS_PORT, () => {
    Logger.success("Global", "expressInit", `Express server is initialized and running on port ${process.env.EXPRESS_PORT}`);
});

let shutdownTries = 0;
// catch Ctrl-C and clean up
process.on("SIGINT", async () => {
    shutdownTries++;
    (shutdownTries > 0) && (shutdownTries % 2 === 0) && process.exit(1);
    shutdownTries % 2 === 1 && Logger.info("Global", "shutdown", "Exit signal received. Cleaning up... CTRL + C one more time to force shutdown!");

    for (const username in userQueueData) {
        userQueueData[username].wantsShutdown = true;
    }

    expressServer.close();
    await mongoClient.close();
    Logger.info("Global", "shutdown", "Servers are off");
    Logger.info("Global", "shutdown", "waiting for trading queue to drain...");

    let jobsLeft = await numJobsLeft();
    while (jobsLeft > 0) {
        Logger.info("Global", "shutdown", `${jobsLeft} job${jobsLeft > 1 ? "s" : ""} left to drain.`);
        await sleep(1000);
        jobsLeft = await numJobsLeft();
    }

    Logger.info("Global", "shutdown", "Trading queue drained");

    await userWorker.close();
    await queueEvents.close();
    await userQueue.close();
    console.log("\nCleaned up, goodbye!");
    process.exit(0);
});
