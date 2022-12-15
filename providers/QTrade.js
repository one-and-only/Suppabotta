import BaseProvider from "./../providers/BaseProvider.js";

export default class QTrade extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.qtrade.io/v1");
    }

    async getMarketPrice(referenceCurrency) {
        throw new Error("This method must be implemented.");
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        throw new Error("This method must be implemented.");
    }
    
    async addSellOrder(amount, price, referenceCurrency) {
        throw new Error("This method must be implemented.");
    }

    async cancelAllPending() {
        throw new Error("This method must be implemented.");
    }

    async orderStatus(orderId) {
        throw new Error("This method must be implemented.");
    }

    async getBalance(currency) {
        throw new Error("This method must be implemented.");
    }
}