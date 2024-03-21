import BaseProvider from "../providers/BaseProvider.js";

export default class BaseStrategy {
    _connectors;
    _socketBroadcaster;
    _paperTradingMongoCollection;
    _recentPaperTrades;

    /**
     * 
     * @param {BaseProvider[]} connectors 
     */
    constructor(connectors, args, paperTradingMongoCollection) {
        this._connectors = connectors;
        this._socketBroadcaster = args.socketBroadcaster;
        this._paperTradingMongoCollection = paperTradingMongoCollection;
        this._recentPaperTrades = [];
    }

    async start() {
        throw new Error("This method must be implemented");
    }

    async tick() {
        throw new Error("This method must be implemented");
    }

    async shutdown() {
        throw new Error("This method must be implemented");
    }

    decimalRounding(floatNum, numDecimals) {
        const numDecimalsFactor = 10 ** (numDecimals - 1);
        return Math.round((floatNum + Number.EPSILON) * numDecimalsFactor) / numDecimalsFactor;
    }

    recentPaperTrades() {
        return this._recentPaperTrades;
    }
}