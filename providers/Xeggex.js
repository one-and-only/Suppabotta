import BaseProvider from "./BaseProvider.js";
import RequestHelper from "../RequestHelper.js";
import { createHmac, randomBytes } from 'crypto';
import Logger from "../Logger.js";

import Bluebird from "bluebird";
const { map: promiseMap } = Bluebird;

export default class Xeggex extends BaseProvider {
    constructor(outboundIp, apiSecret, apiKey, baseCurrency) {
        super(outboundIp, apiSecret, apiKey, "https://api.xeggex.com/api/v2", baseCurrency, 0.3, 0.3, 0.62, true, [0, 1], "_", "Xeggex");
        this._requestHelper = new RequestHelper(
            {
                public: {
                    amount: -1,
                    interval: -1
                }
            },
            true,
            this._outboundIp
        );
    }

    async initialize() {
        await this.allTradingPairs();
        return this;
    }

    async allTradingPairs() {
        try {
            const markets = await (await this._requestHelper.get(`${this._apiUrl}/market/getlist`)).json();

            for (const market of markets) {
                this._minTradeVolumes[market.symbol.split("/").join("_")] = market.minimumQuantity ?? 0;

                if (!market.symbol.startsWith(this._baseCurrency)) continue;

                this._tradingPairs[market.symbol.split("/")[1]] = { pair: market.symbol, enabled: true };
            }
        } catch (e) {
            Logger.error(this._name, "initialize_allTradingPairs", "Failed to get market info");
        }
    }

    authHeaders(url, body) {
        const nonce = `${Date.now()}`;

        return {
            "Content-Type": "application/json",
            "X-API-KEY": this._apiKey,
            "X-API-NONCE": nonce,
            "X-API-SIGN": createHmac("sha256", this._apiSecret).update(this._apiKey + url + body + nonce).digest("hex")
        };
    }

    async getAllMarkets() {
        const marketData = await (await this._requestHelper.get(`${this._apiUrl}/markets?type=spot`)).json();
        const markets = [];

        for (const market of marketData) {
            markets.push({
                referenceCurrency: market.quote,
                baseCurrency: market.base
            });
        }

        return markets;
    }

    async getOrderBook(baseCurrency, referenceCurrency) {
        try {
            const orderBook = await (await this._requestHelper.get(`${this._apiUrl}/market/getorderbookbysymbol/${this.coinsToExchangePair([baseCurrency, referenceCurrency])}`)).json();

            return {
                bid: orderBook.bids.map(x => {
                    return {
                        price: x.numberprice,
                        amount: parseFloat(x.quantity)
                    };
                }),
                ask: orderBook.asks.map(x => {
                    return {
                        price: x.numberprice,
                        amount: parseFloat(x.quantity)
                    };
                })
            };
        } catch (e) {
            return {
                bid: [],
                ask: []
            };
        }
    }

    async getMarketPrice(referenceCurrency, baseCurrency = "RTM") {
        try {
            const orderBook = await (await this._requestHelper.get(`${this._apiUrl}/market/getorderbookbysymbol/${this.coinsToExchangePair([baseCurrency, referenceCurrency])}`)).json();

            const bid = orderBook.bids[0];
            const ask = orderBook.asks[0];

            return {
                success: true,
                sellPrice: bid.numberprice,
                sellDepth: parseFloat(bid.quantity),
                buyPrice: ask.numberprice,
                buyDepth: parseFloat(ask.quantity)
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get market price"
            };
        }
    }

    async submitOrder(baseAmount, price, referenceCurrency, baseCurrency, isBuy) {
        const url = `${this._apiUrl}/createorder`;
        const body = {
            "userProvidedId": randomBytes(16).toString("hex"),
            "symbol": this.coinsToExchangePair([baseCurrency.toUpperCase(), referenceCurrency.toUpperCase()]),
            "side": isBuy ? "buy" : "sell",
            "type": "limit",
            "quantity": baseAmount.toString(),
            "price": price.toString(),
            "strictValidate": false
        };

        try {
            const response = await (await this._requestHelper.post(
                url,
                body,
                true,
                this.authHeaders(url, body)
            )).text();

            if (parseFloat(response.remainQuantity) > 0) {
                this._pendingTrades.push({ id: response.id, referenceCurrency: referenceCurrency, baseCurrency: baseCurrency, amount: baseAmount, price: price, isBuy: isBuy });
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    async addBuyOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, true);
    }

    async addSellOrder(baseAmount, price, referenceCurrency, baseCurrency) {
        return this.submitOrder(baseAmount, price, referenceCurrency, baseCurrency, false);
    }

    async cancelAllPending() {
        for (const orderId of this._pendingTrades) {
            const url = `${this._apiUrl}/cancelOrder`;
            const body = {
                id: orderId
            };

            try {
                await this._requestHelper.post(
                    url,
                    body,
                    true,
                    this.authHeaders(url, body)
                );
            } catch (e) {
                continue;
            }
        }

        this._pendingTrades = [];
        return true;
    }

    getPendingOrders() {
        return this._pendingTrades;
    }

    async prunePendingOrders() {
        this._pendingTrades = (await promiseMap(
            this._pendingTrades,
            async order => {
                const orderStatus = await this.orderStatus(order.id);
                if (orderStatus.success && orderStatus.quantityLeft > 0) return order;

                return "";
            }
        )).filter(x => x !== "");
    }

    async orderStatus(orderId) {
        try {
            const url = `${this._apiUrl}/getorder/${orderId}`;
            const orderStatus = await (await this._requestHelper.get(url, true, this.authHeaders(url, ""))).json();

            if (orderStatus.error) {
                return {
                    success: false,
                    error: "Failed to get order status"
                };
            }

            if (parseFloat(orderStatus.remainQuantity) === 0) {
                return {
                    success: false,
                    error: "Order already fulfilled"
                };
            }

            return {
                success: true,
                type: `${orderStatus.type.toUpperCase()}_${orderStatus.side.toUpperCase()}`,
                market: orderStatus.result.Exchange,
                price: parseFloat(orderStatus.price),
                quantityLeft: parseFloat(orderStatus.remainQuantity)
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get order status"
            };
        }
    }

    async getBalance(currency) {
        try {
            const url = `${this._apiUrl}/balances`;
            const balances = await (await this._requestHelper.get(url, true, this.authHeaders(url, ""))).json();

            if (balances.error) {
                return {
                    success: false,
                    error: "Failed to get balance"
                };
            }

            for (const balance of balances) {
                if (balance.asset === currency.toUpperCase()) {
                    const available = parseFloat(balance.available);
                    const pending = parseFloat(balance.pending);
                    return {
                        success: true,
                        total: available + pending,
                        available: available
                    };
                }
            }

            return {
                success: false,
                error: "Invalid currency"
            };
        } catch (e) {
            return {
                success: false,
                error: "Failed to get balance"
            };
        }
    }
}