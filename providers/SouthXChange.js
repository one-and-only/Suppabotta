import BaseProvider from "./BaseProvider.js";
import { createHmac } from "crypto";
import RequestHelper from "../RequestHelper.js";
import Logger from "../Logger.js";

export default class SouthXChange extends BaseProvider {
    constructor(apiSecret, apiKey) {
        super(apiSecret, apiKey, "https://www.southxchange.com/api/v4", 0.1, 0.3, 0.00001354, true, [0, 1], "_", "SouthXChange");
        this._requestHelper = new RequestHelper({
            public: {
                amount: -1,
                interval: -1
            }
        }, true);
    }

    privateBodyParams() {
        return {
            key: this._apiKey,
            nonce: Date.now()
        };
    }

    /**
     * Generate an HMAC-SHA512 hash to be used in private SouthXChange requests
     * @param {string} data string to hash
     * @returns {string} hex representation of HMAC-SHA512 hash
    */
    generateHmac512(data) {
        return createHmac("sha512", this._apiSecret).update(data).digest("hex");
    }

    privateHeaders(body) {
        return {
            "Content-Type": "application/json",
            Hash: this.generateHmac512(JSON.stringify(body))
        }
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        try {
            const markets = await (await this._requestHelper.get(`${this._apiUrl}/markets`)).json();

            for (const market of markets) {
                if (market[0] !== "RTM") continue;

                const tradingPair = `${market[0]}_${market[1]}`;
                this._tradingPairs[market[1]] = { pair: tradingPair, enabled: true };
                this._minTradeVolumes[market[1]] = Number.MIN_VALUE // TODO find the actual min trade volume
            }
        } catch (e) {
            Logger.error(this._name, "initialize_allTradingPairs", "Failed to get market info");
        }
    }

    async getAllMarkets() {
        return (await (await this._requestHelper.get(`${this._apiUrl}/markets`)).json()).map(x => {
            return {
                referenceCurrency: x[1],
                baseCurrency: x[0]
            };
        });
    }

    async getMarketPrice(referenceCurrency, baseCurrency="RTM") {
        try {
            const orderBook = await (await this._requestHelper.get(`${this._apiUrl}/book/${baseCurrency.toUpperCase()}/${referenceCurrency.toUpperCase()}`)).json();
            if (orderBook === "") return { success: false, error: "Invalid reference currency" };

            return {
                success: true,
                sellPrice: orderBook.BuyOrders[0].Price,
                sellDepth: orderBook.BuyOrders[0].Amount,
                buyPrice: orderBook.SellOrders[0].Price,
                buyDepth: orderBook.SellOrders[0].Amount
            }
        } catch (e) {
            return {
                success: false,
                error: "Failed to get market price"
            };
        }
    }

    /**
     * Submit an order to SouthXChange
     * @param {number} baseAmount amount of base currency to buy/sell
     * @param {number} price price per baseCurrency
     * @param {string} referenceCurrency currency you're pairing baseCurrency with
     * @param {string} type type of trade ("buy" or "sell")
     * @returns {Promise<boolean>} success or failure
     */
    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, type) {
        const body = {
            listingCurrency: baseCurrency.toUpperCase(),
            referenceCurrency: referenceCurrency.toUpperCase(),
            type: type,
            amount: baseAmount,
            limitPrice: price,
            ...this.privateBodyParams()
        };

        try {
            const orderResponse = await this._requestHelper.post(
                `${this._apiUrl}/placeOrder`,
                body,
                true,
                this.privateHeaders(body)
            );
            const status = orderResponse.status;
            const orderId = await orderResponse.text();

            if (status === 400) {
                Logger.error(this._name, `submitOrder_${type}`, `Failed to submit order (${orderId})`);
                return false;
            }
            if (status === 200 && orderId.length !== 0) {
                this._pendingTrades.push(orderId)
                return true;
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, "buy");
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, "sell");
    }

    async cancelAllPending() {
        for (const pendingTradeCode of this._pendingTrades) {
            const body = {
                orderCode: pendingTradeCode,
                ...this.privateBodyParams()
            };

            try {
                const cancelOrderResponse = await this._requestHelper.post(
                    `${this._apiUrl}/cancelOrder`,
                    body,
                    true,
                    this.privateHeaders(body)
                );
                if (cancelOrderResponse.status !== 200) return false;
            } catch (e) {
                continue;
            }
        }

        this._pendingTrades = [];
        return true;
    }

    async orderStatus(orderId) {
        try {
            const pendingOrdersResponse = await this._requestHelper.post(
                `${this._apiUrl}/listOrders`,
                this.privateBodyParams(),
                true,
                this.privateHeaders(body)
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
        } catch (e) {
            return {
                success: false,
                error: "Failed to get order status"
            };
        }
    }

    async getBalance(currency) {
        try {
            const balancesResponse = await this._requestHelper.post(
                `${this._apiUrl}/listBalances`,
                this.privateBodyParams(),
                true,
                this.privateHeaders(body)
            );

            if (balancesResponse.status !== 200) {
                const text = await balancesResponse.text();
                console.log(text);
                return { success: false, error: text };
            }

            const balances = await balancesResponse.json();
            for (const balance of balances) {
                if (balance.Currency === currency)
                    return {
                        success: true,
                        total: balance.Deposited,
                        available: balance.Available
                    };
            }
        } catch (e) {
            return {
                success: false,
                error: "Failed to get balance"
            };
        }
    }
}