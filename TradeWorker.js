import BullMQ from 'bullmq';
const { SandboxedJob } = BullMQ;

import IORedis from "ioredis";
import { MongoClient } from "mongodb";

import IP from "ip";
const { address: ipAddress } = IP;

import { apiRateLimits } from "./APIRateLimits.js";
import RequestHelper from "./RequestHelper.js";
import Logger from "./Logger.js";

import TradeOgre from "./providers/TradeOgre.js";
import CoinEx from "./providers/CoinEx.js";
import DexTrade from "./providers/DexTrade.js";
import Xeggex from "./providers/Xeggex.js";
import NonKYC from "./providers/NonKYC.js";

import TickerMaintenanceStrategy from "./strategies/TickerMaintenance.js";
import ClassicArbitrageStrategy from "./strategies/ClassicArbitrage.js";
import FloatingArbitrageStrategy from "./strategies/FloatingArbitrage.js";

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

/**
 * * Expect the following for job data:
 * {
 *  strategy: "StrategyNameStr",
 *  username: "UsernameStr",
 *  apiCreds: (connectorNameIndex: string){key: string, secret: string}
 *  strategyArgs: strategyArgsObj
 *  redis: {host: string, port: string},
 *  mongo: {address: string, username: string, password: string, database: string}
 *  jobId: string
 * }
 */
export default async function process(job) {
    Logger.info(job.data.strategy, "startup", "Connecting to servers...");

    const redisConnection = new IORedis(parseInt(job.data.redis.port), job.data.redis.host, { maxRetriesPerRequest: null });

    const mongoClient = new MongoClient(`mongodb://${job.data.mongo.username}:${job.data.mongo.password}@${job.data.mongo.address}?authMechanism=DEFAULT`);
    await mongoClient.connect();
    const paperTradingHistory = mongoClient.db(job.data.mongo.database).collection("PaperTradingHistory");

    const strategyInfo = strategyMaps[job.data.strategy];
    const providers = [];

    Logger.info(job.data.strategy, "startup", "Initializing connectors...");

    const outboundIp = job.data.strategyArgs.customLocalIp ?? ipAddress();
    for (const providerClass of strategyInfo.providers) {
        const providerCreds = job.data.apiCreds[providerClass.name.toLowerCase()];
        if (!providerCreds) continue;

        const requestHelper = new RequestHelper(
            apiRateLimits[providerClass.name],
            !apiRateLimits[providerClass.name].hasOwnProperty("private"),
            outboundIp
        );

        providers.push(await new providerClass(outboundIp, requestHelper, providerCreds.secret, providerCreds.key, job.data.strategyArgs.baseCurrency).initialize());
    }

    const strategyInstance = new strategyInfo.strategyClass(providers, { ...(job.data.strategyArgs), socketBroadcaster: null }, paperTradingHistory);

    Logger.info(job.data.strategy, "startup", "Starting trade strategy...");

    await redisConnection.set(job.data.jobId, "active");
    await strategyInstance.start();

    while (await redisConnection.get(job.data.jobId)) {
        await strategyInstance.tick();
    }

    Logger.info(job.data.strategy, "shutdown", "Starting trade strategy shutdown...");

    // clean up
    await strategyInstance.shutdown();
    await redisConnection.quit();
    await mongoClient.close();
}