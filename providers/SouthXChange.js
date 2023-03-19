import BaseProvider from "./../providers/BaseProvider.js";
import { createHmac } from "crypto";
import map from "bluebird";
import RequestHelper from "../requestHelper.js";

export default class SouthXChange extends BaseProvider {
    constructor(apiSecret, apiKey) {
        // TODO get the actual withdrawal fee for SouthX
        super(apiSecret, apiKey, "https://www.southxchange.com/api/v4", 0.1, 0.3, 0, "SouthXChange");
        this._requestHelper = new RequestHelper({
            public: {
                amount: -1,
                interval: -1
            }
        });
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        const markets = await (await this._requestHelper.get(`${this._apiUrl}/markets`)).json();

        for (const market of markets) {
            if (market[0] !== "RTM") continue;

            const tradingPair = `${market[0]}_${market[1]}`;
            this._tradingPairs[market[1]] = { pair: tradingPair, enabled: true };
            this._minTradeVolumes[tradingPair] = Number.MIN_VALUE // TODO find the actual min trade volume
        }
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
        const priceData = await (await this._requestHelper.get(`${this._apiUrl}/price/RTM/${referenceCurrency}`)).json();
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

        const orderResponse = await this._requestHelper.post(
            `${this._apiUrl}/placeOrder`,
            body,
            true,
            {
                "Content-Type": "application/json",
                "Hash": this.generateHmac512(body)
            }
        );
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

        for (const pendingTradeCode of this._pendingTrades) {
            const body = JSON.stringify({
                orderCode: pendingTradeCode
            });

            const cancelOrderResponse = await this._requestHelper.post(
                `${this._apiUrl}/cancelOrder`,
                body,
                true,
                {
                    "Content-Type": "application/json",
                    "Hash": this.generateHmac512(body)
                }
            );
            if (cancelOrderResponse.status !== 200) return false;
        }

        this._pendingTrades = [];
        return true;
    }

    async orderStatus(orderId) {
        const pendingOrdersResponse = await this._requestHelper.post(
            `${this._apiUrl}/listOrders`,
            "",
            true,
            {
                "Hash": this.generateHmac512("")
            }
        );

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
                    market: `${pendingOrder.listingCurrency}_${pendingOrder.ReferenceCurrency}`,
                    price: pendingOrder.LimitPrice,
                    quantityLeft: pendingOrder.Amount
                };
        }

        return { success: false, error: "Invalid order ID or order already completed" };
    }

    async getBalance(currency) {
        const balancesResponse = await this._requestHelper.post(
            `${this._apiUrl}/listBalances`,
            "",
            true,
            {
                "Hash": this.generateHmac512("")
            }
        );

        if (balancesResponse.status !== 200) {
            const text = await balancesResponse.text();
            console.log(text);
            return { success: false, error: text };
        }

        const balances = await balancesResponse.json();
        for (const balance in balances) {
            console.log(balance);
            if (balance.Currency === currency)
                return {
                    success: true,
                    total: -1,
                    available: balance.available
                };
        }
    }
}