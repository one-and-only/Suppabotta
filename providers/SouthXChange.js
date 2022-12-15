import BaseProvider from "./../providers/BaseProvider.js";
import fetch from "node-fetch";
import { createHmac } from "crypto";
import map from "bluebird";

export default class SouthXChange extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://www.southxchange.com/api/v4");
    }

    /**
     * Generate an HMAC-SHA512 hash to be used in private SouthXChange requests
     * @param {string} data string to hash
     * @returns {string} hex representation of HMAC-SHA512 hash
     */
    generateHmac512(data) {
        return createHmac("sha512", this._apiSecret).update(data).digest("hex");
    }

    async getMarketPrice(referenceCurrency) {
        const priceData = await (await fetch(`${this._apiUrl}/price/RTM/${referenceCurrency}`)).json();
        if (priceData === "") return { success: false, error: "Invalid reference currency" };

        return {
            success: true,
            sell: priceData.Bid,
            buy: priceData.Ask,
        }
    }

    /**
     * Submit an order to SouthXChange
     * @param {number} amount amount of RTM to buy/sell
     * @param {number} price price per RTM
     * @param {string} referenceCurrency currency you're pairing RTM with
     * @param {string} type type of trade ("buy" or "sell")
     * @returns {Promise<boolean>} success or failure
     */
    async submitOrder(amount, price, referenceCurrency, type) {
        const body = JSON.stringify({
            listingCurrency: "RTM",
            referenceCurrency: referenceCurrency,
            type: type,
            amount: amount,
            limitPrice: price,
            nonce: Date.now(),
            key: this._apiKey
        });

        const orderResponse = await fetch(`${this._apiUrl}/placeOrder`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Hash": this.generateHmac512(body)
            },
            body: body
        });
        const status = orderResponse.status;
        const orderId = await orderResponse.text();

        if (status === 400) {
            console.log(orderResponse)
            return false;
        }
        if (status === 200 && orderId.length !== 0) {
            this._pendingTrades.push(orderId)
            return true;
        }

        return false;
    }

    async addBuyOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, "buy");
    }

    async addSellOrder(amount, price, referenceCurrency) {
        return this.submitOrder(amount, price, referenceCurrency, "sell");
    }

    async cancelAllPending() {
        // there aren't any pending orders
        if (this._pendingTrades.length < 1) return true;

        const didSucceeds = await map(this._pendingTrades, async (pendingTradeCode) => {
            console.log(`Cancelling order ${pendingTradeCode}`);

            const body = JSON.stringify({
                orderCode: pendingTradeCode
            });
            const cancelOrderResponse = await fetch(`${this._apiUrl}/cancelOrder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Hash": this.generateHmac512(body)
                },
                body: body
            });

            if (cancelOrderResponse.status === 200) return true;
            else {
                console.log(await cancelOrderResponse.text());
                return false;
            }
        });
        this._pendingTrades = [];

        for (const didSucceed in didSucceeds)
            if (didSucceed !== true) return false;

        return true;
    }

    async orderStatus(orderId) {
        const pendingOrdersResponse = await fetch(`${this._apiUrl}/listOrders`, {
            method: "POST",
            headers: {
                "Hash": this.generateHmac512("")
            }
        });

        if (pendingOrdersResponse.status !== 200) {
            const text = await pendingOrdersResponse.text();
            console.log(text);
            return { success: false, error: text };
        }

        const pendingOrders = await pendingOrdersResponse.json();
        for (const pendingOrder in pendingOrders) {
            if (pendingOrder.Code === orderId)
                return {
                    success: true,
                    type: pendingOrder.Type,
                    market: pendingOrder.ReferenceCurrency,
                    price: pendingOrder.LimitPrice,
                    quantityLeft: pendingOrder.Amount
                };
        }

        return { success: false, error: "Invalid order ID" };
    }

    async getBalance(currency) {
        const balancesResponse = await fetch(`${this._apiUrl}/listBalances`, {
            method: "POST",
            headers: {
                "Hash": this.generateHmac512("")
            }
        });

        if (balancesResponse.status !== 200) {
            const text = await balancesResponse.text();
            console.log(text);
            return { success: false, error: text };
        }

        const balances = await balancesResponse.json();
        for (const balance in balances) {
            console.log(balance);
            // TODO check for capitalization
            if (balance.Currency === currency)
                return {
                    success: true,
                    total: -1,
                    available: balance.available
                };
        }
    }
}