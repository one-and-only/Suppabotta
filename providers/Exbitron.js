import BaseProvider from "../providers/BaseProvider.js";
import RequestHelper from "../requestHelper.js";

// TODO finish this later
//! Exbitron's API is not fully working
// I believe they will make a new API in a few weeks
export default class Exbitron extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://www.exbitron.com/api/v2/peatio", 0.4, 0.4, 0.01, "Exbitron");
        this._requestHelper = new RequestHelper({
            public: {
                amount: -1,
                interval: -1
            }
        }, true);
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {

    }
}