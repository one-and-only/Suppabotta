import BaseProvider from "../providers/BaseProvider.js";

export default class BaseStrategy {
    _connectors;
    _paperTradingMongoCollection;
    _recentPaperTrades;

    /**
     * 
     * @param {BaseProvider[]} connectors 
     */
    constructor(connectors, args, paperTradingMongoCollection) {
        this._connectors = connectors;
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

    // this will only be overridden by FloatingArbitrage
    // other strategies won't have pending trades
    pendingTrades() {
        const pendingTrades = {};
        
        for (const connector of this._connectors) {
            pendingTrades[connector._name] = [];
        }

        return pendingTrades;
    }
}