import BaseProvider from "./BaseProvider";
import fetch from "node-fetch";
import { createHash } from "crypto";
import {map as promiseMap} from "bluebird";

export default class QTrade extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://api.dex-trade.com/v1");
    }

    async getMarketPrice(referenceCurrency) {
        const orderBookResponse = await fetch(`${this._apiUrl}/public/book?pair=RTM${referenceCurrency}`);

        if (orderBookResponse.status === 400) return { success: false, error: "Invalid reference currency" }

        const data = (await orderBookResponse.json()).data;
        return {
            success: true,
            sell: data.buy[0].rate,
            buy: data.sell[0].rate,
        };
    }

    /**
     * 
     * @param {number} amount amount of RTM you're selling or buying
     * @param {number} price price per RTM
     * @param {string} referenceCurrency currency you're pairing RTM with
     * @param {boolean} isBuy Whether the trade is of type "buy" or not (type "sell")
     * @returns {boolean} success or failure
     */
    async submitOrder(amount, price, referenceCurrency, isBuy) {
        const body = JSON.stringify({
            pair: `RTM${referenceCurrency}`,
            rate: price,
            request_id: Date.now(),
            type: isBuy ? 0 : 1,
            type_trade: 0,
            volume: amount
        });
        const createOrderResponse = await fetch(`${this._apiUrl}/private/create-order`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "login-token": this._apiKey,
                "x-auth-sign": createHash("sha256").update(body + this._apiSecret).digest("hex")
            },
            body: body
        });

        if (createOrderResponse.status === 200) {
            const pendingOrder = await createOrderResponse.json();
            this._pendingTrades.push(pendingOrder.data.id);
            return true;
        }
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, true);
    }
    
    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, false);
    }

    async cancelAllPending() {
        const didSucceeds = await promiseMap(this._pendingTrades, async (pendingTradeId) => {
            const body = JSON.stringify({
                order_id: pendingTradeId,
                request_id: Date.now()
            });
            const res = await fetch(`${this._apiUrl}/private/delete-order`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "login-token": this._apiKey,
                    "x-auth-sign": createHash("sha256").update(body + this._apiSecret).digest("hex")
                },
                body: body
            });

            if (res.status === 200) return { success: true };
            else return { success: false, response: await res.text() }
        });
        this._pendingTrades = [];

        for (const didSucceed in didSucceeds)
            if (didSucceed !== true) return false;

        return true;
    }

    async orderStatus(orderId) {
        throw new Error("This method must be implemented.");
    }

    async getBalance(currency) {
        throw new Error("This method must be implemented.");
    }
}