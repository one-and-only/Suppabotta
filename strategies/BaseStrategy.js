import BaseProvider from "../providers/BaseProvider.js";

export default class BaseStrategy {
    /**
     * 
     * @param {BaseProvider[]} connectors 
     */
    constructor(connectors, args) {
        this._connectors = connectors;
        this._socketBroadcaster = args.socketBroadcaster;
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
}