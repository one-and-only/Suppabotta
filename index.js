import { createServer as createHttpsServer } from "https";
import * as path from "path";
import { fileURLToPath } from 'url';
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
import { verify as verifyPassword, hash as hashPassword } from "argon2";
import express from "express";
import { promisify } from "util";
import Logger from "./Logger.js";
import { v4 as uuidv4 } from 'uuid';

const sleep = promisify(setTimeout);

import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";

const validStrategies = ["TickerMaintenance", "ClassicArbitrage", "FloatingArbitrage"];

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
const userWorker = new Worker("userQueue", path.join(path.dirname(fileURLToPath(import.meta.url)), "TradeWorker.js"), { connection: redisConnection, useWorkerThreads: true });

async function numJobsLeft() {
    return await userQueue.getActiveCount();
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

/**
 * Get the BullMQ.Job<...> the unique job ID belongs to
 * @param {string} jobId ID of the job, but really it's the `name` in BullMQ terms
 * @returns 
 */
async function getTargetJob(jobId) {
    const filteredJobs = (await userQueue.getActive()).filter(x => x.name === jobId);

    return filteredJobs.length > 0 ? filteredJobs[0] : null;
}

app.post("/stopTrading", async (req, res) => {
    if (!req.query.jobId) {
        res.status(400).json({
            success: false,
            error: "job ID not provided"
        });
        return;
    }

    let targetJob = await getTargetJob(req.query.jobId);

    if (!targetJob) {
        res.status(400).json({
            success: false,
            error: "Trading thread does not exist"
        });
        return;
    }

    await redisConnection.del(req.query.jobId);

    // wait for the job to shut down before returning an API response
    while (await getTargetJob(req.query.jobId)) await sleep(1000);

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

    if (!validStrategies.includes(req.query.strategy)) {
        res.status(400).json({
            success: false,
            error: "Invalid trading strategy"
        });
        return;
    }

    const jobId = uuidv4();
    await userQueue.add(jobId, {
        username: req.query.username,
        strategy: req.query.strategy,
        strategyArgs: req.query.args ? JSON.parse(req.query.args) : {},
        apiCreds: userInfo.apiCreds,
        redis: {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT
        },
        mongo: {
            address: process.env.MONGODB_ADDRESS,
            username: process.env.MONGODB_USER,
            password: process.env.MONGODB_PASS,
            database: process.env.MONGODB_DATABASE,
        },
        jobId: jobId,
    });

    res.json({
        success: true,
        message: "Job added to queue",
        jobId: jobId
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
    Logger.success("Global", "shutdown", "Cleaned up, goodbye!");
    process.exit(0);
});
