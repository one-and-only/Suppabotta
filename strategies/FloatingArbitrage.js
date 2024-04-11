import Logger from "../Logger.js";
import { promisify } from 'node:util';
import Bluebird from "bluebird";
import BaseArbitrage from "./BaseArbitrage.js";
import BaseProvider from "../providers/BaseProvider.js";

const { map: promiseMap } = Bluebird;
const sleep = promisify(setTimeout);

export default class FloatingArbitrageStrategy extends BaseArbitrage {
    _maxInvPct;
    _inventoryDefinition;
    _unfitToRun;
    _maxPriceDropPct;
    _currencyUsed;
    _numCurveOrders;
    _trackedOrders;

    constructor(connectors, args, paperTradingMongoCollection) {
        super(connectors, args, paperTradingMongoCollection);
        this._unfitToRun = false;

        if (!args.baseCurrency || !args.baseCurrency || !args.maxInvPct || !args.inventoryDefinition || !args.numCurveOrders) {
            args.baseCurrency = "RTM";
            Logger.error("FloatingArbitrage", "startup", "One or more required arguments not provided", this._socketBroadcaster);
            this._unfitToRun = true;
            return;
        }

        this._maxInvPct = args.maxInvPct;
        this._inventoryDefinition = args.inventoryDefinition;
        this._numCurveOrders = args.numCurveOrders;
        this._trackedOrders = [];

        this._currencyUsed = {};
        for (const connector of Object.keys(args.inventoryDefinition)) {
            const currencyDefinitions = args.inventoryDefinition[connector];

            this._currencyUsed[connector] = {};
            for (const currency of Object.keys(currencyDefinitions)) {
                this._currencyUsed[connector][currency] = 0;
            }
        }

        this._maxPriceDropPct = args.maxPriceDropPct ?? 5;
    }

    pendingTrades() {
        const ret = {};

        for (const connector of this._connectors) {
            ret[connector._name] = [];
        }

        for (const trackedOrder of this._trackedOrders) {
            ret[trackedOrder.coverExchange._name].push(...trackedOrder.coverOrders.map(
                order => {
                    return {
                        baseCurrency: trackedOrder.tradingPair.baseCurrency,
                        referenceCurrency: trackedOrder.tradingPair.referenceCurrency,
                        ...order
                    };
                }
            ));

            ret[trackedOrder.curveExchange._name].push(...trackedOrder.curveOrders.map(
                order => {
                    return {
                        baseCurrency: trackedOrder.tradingPair.baseCurrency,
                        referenceCurrency: trackedOrder.tradingPair.referenceCurrency,
                        ...order
                    };
                }
            ));
        }

        return ret;
    }

    /**
    * Check if this algorithm can run with the condition of the user's exchange accounts
    */
    async fitToRun() {
        // gather and check the balances of the user against the defined inventory
        // simulatenously calculates whether the algorithm is fit to run based on those balances
        Logger.info("FloatingArbitrage", "fitToRun", "Verifying existence of defined inventory", this._socketBroadcaster);

        this._unfitToRun = !((await promiseMap(this._connectors, async connector => {
            return (await promiseMap(Object.keys(this._inventoryDefinition[connector._name]), async currencyCode => {
                const balanceInfo = await connector.getBalance(currencyCode);
                if (!balanceInfo?.success) return false;

                return balanceInfo.available >= this._inventoryDefinition[connector._name][currencyCode];
            })).every(val => val);
        })).every(val => val));
    }

    /**
     * Get the amount of coins that can be used for future trades
     * @param {string} currency Currency identifier to get the amount of coins for
     * @returns {number} how many coins of `currency` are available for use in trades compared to total allocation
     */
    currencyInUse(currency) {
        if (!this._currencyUsed[currency]) return 0;

        return (this._inventoryDefinition[currency] - this._currencyUsed[currency]);
    }

    async allMarketInfos() {
        return await promiseMap(this._connectors, async (connector) => {
            const orderBookInfos = await this.baseCurrencyOrderBookInfosForConnector(connector);
            const tradingPairInfos = [];

            for (const orderBookInfo of orderBookInfos) {
                const buyDepthInfo = await this.calculateDepth(connector, { baseCurrency: orderBookInfo.baseCurrency, referenceCurrency: orderBookInfo.referenceCurrency }, "ask", orderBookInfo);
                const sellDepthInfo = await this.calculateDepth(connector, { baseCurrency: orderBookInfo.baseCurrency, referenceCurrency: orderBookInfo.referenceCurrency }, "bid", orderBookInfo);

                tradingPairInfos.push({
                    baseCurrency: orderBookInfo.baseCurrency,
                    referenceCurrency: orderBookInfo.referenceCurrency,
                    buyDepth: buyDepthInfo.amount,
                    buyDepthEntries: buyDepthInfo.relevantBookEntries,
                    sellDepth: sellDepthInfo.amount,
                    sellDepthEntries: sellDepthInfo.relevantBookEntries
                });
            }

            return { connector: connector, tradingPairs: tradingPairInfos };
        });
    }

    /**
     * @typedef {Object} DepthEntry
     * @property {number} amount amount of coins at a depth level
     * @property {number} price price of the coins at a depth level
     */
    /**
     * @typedef {DepthEntry} Order
     */
    /**
     * @typedef {Object} TradingPairInfo
     * @property {number} buyDepth amount of coins that can be bought without shifting the price by this._maxPriceDropPct
     * @property {number} sellDepth amount of coins that can be sold without shifting the price by this._maxPriceDropPct
     * @property {string} baseCurrency Base currency of the trading pair
     * @property {string} referenceCurrency Reference currency of the trading pair
     * @property {DepthEntry[]} buyDepthEntries The relevant depth values on the buy side
     * @property {DepthEntry[]} sellDepthEntries The relevant depth values on the sell side
     */
    /**
     * @typedef {Object} PolarEntry
     * @property {BaseProvider} badDepthExchange
     * @property {BaseProvider} goodDepthExchange
     * @property {number} depthDelta
     * @property {string} goodExchangeSide
     * @property {TradingPairInfo} goodExchangePairInfo
     * @property {string} badExchangeSide
     * @property {TradingPairInfo} badExchangePairInfo
     */
    /**
     * Get the exchange that has the worst depth and the exchange that has the best depth for each baseCurrency trading pair
     * @returns {Promise<{[pairId:string]:{badDepthExchange:BaseProvider,goodDepthExchange:BaseProvider,depthDelta:number,goodExchangeSide:string,goodExchangePairInfo:TradingPairInfo,badExchangeSide:string,badExchangePairInfo:TradingPairInfo}}>}
     */
    async getPolarExchanges() {
        const polarExchangesAlreadyProcessed = [];
        const polarEntries = {};

        const comboAlreadyProcessed = (pairA, pairB) => {
            for (const alreadyProcessedCombo of polarExchangesAlreadyProcessed) {
                if (
                    // the first two are reversed on purpose
                    // the same order can't happen more than once and because there's only regular and reverse order available, it has to be reverse by default
                    (JSON.stringify(pairB.tradingPair) === JSON.stringify(alreadyProcessedCombo[0].tradingPair)) &&
                    (JSON.stringify(pairA.tradingPair) === JSON.stringify(alreadyProcessedCombo[1].tradingPair)) &&
                    (pairB.connector._name === alreadyProcessedCombo[0].connector._name) &&
                    (pairA.connector._name === alreadyProcessedCombo[1].connector._name)
                ) return true;

                return false;
            }
        };

        const updateMostPolarEntry = (pair, goodDepthConnector, badDepthConnector, goodDepthSide, goodDepthPairInfo, badDepthSide, badDepthPairInfo) => {
            polarEntries[pair] = {
                badDepthExchange: badDepthConnector,
                goodDepthExchange: goodDepthConnector,
                depthDelta: goodDepthPairInfo[goodDepthSide] - badDepthPairInfo[badDepthSide],
                goodExchangeSide: goodDepthSide,
                goodExchangePairInfo: goodDepthPairInfo,
                badExchangeSide: badDepthSide,
                badExchangePairInfo: badDepthPairInfo,
            };
        };

        const getMostPolarEntryForPair = (pair) => {
            const pairId = `${pair.referenceCurrency}${pair.baseCurrency}`;

            // if this is true, there are no polar entries stored yet
            if (!polarEntries.hasOwnProperty(pairId)) return {
                badDepthExchange: null,
                goodDepthExchange: null,
                depthDelta: 0,
                goodExchangeSide: null,
                goodExchangePairInfo: {},
                badExchangeSide: null,
                badExchangePairInfo: {},
            };

            const polarityEntry = polarEntries[pairId];
            return {
                badDepthExchange: polarityEntry.badDepthExchange,
                goodDepthExchange: polarityEntry.goodDepthExchange,
                depthDelta: polarityEntry.depthDelta,
                goodExchangeSide: polarityEntry.goodExchangeSide,
                goodExchangePairInfo: polarityEntry.goodExchangePairInfo,
                badExchangeSide: polarityEntry.badExchangeSide,
                badExchangePairInfo: polarityEntry.badExchangePairInfo,
            };
        }

        const marketInfos = await this.allMarketInfos();

        for (const currentMarketInfo of marketInfos) {
            for (const currentPair of currentMarketInfo.tradingPairs) {
                for (const otherMarketInfo of marketInfos) {
                    if (currentMarketInfo.connector._name === otherMarketInfo.connector._name) continue;

                    for (const otherPair of otherMarketInfo.tradingPairs) {
                        let currentCorrectDepthKey = "buyDepth";
                        if (comboAlreadyProcessed({ connector: currentMarketInfo.connector, tradingPair: currentPair }, { connector: otherMarketInfo.connector, tradingPair: otherPair })) currentCorrectDepthKey = "sellDepth";

                        const otherCorrectDepthKey = currentCorrectDepthKey === "buyDepth" ? "sellDepth" : "buyDepth";

                        const executePolarityScan = () => {
                            polarExchangesAlreadyProcessed.push([{ connector: currentMarketInfo.connector, tradingPair: currentPair }, { connector: otherMarketInfo.connector, tradingPair: otherPair }]);

                            const currentPairDepth = currentPair[currentCorrectDepthKey];
                            const otherPairDepth = otherPair[otherCorrectDepthKey];
                            const localDepthDelta = currentPairDepth - otherPairDepth;
                            const localDepthDeltaAbs = Math.abs(localDepthDelta);

                            const currentlyMostPolar = getMostPolarEntryForPair(currentPair); // the data used from currentMarketInfo and otherMarketInfo should be the same here

                            if (localDepthDeltaAbs > currentlyMostPolar.depthDelta) {
                                const currentConnectorHasBetterDepth = localDepthDelta > 0; // currentDepth - otherDepth > 0 means that current connector depth is always greater
                                const currentConnectorCorrectSide = currentConnectorHasBetterDepth ? currentCorrectDepthKey : otherCorrectDepthKey;
                                const otherConnectorCorrectSide = currentConnectorCorrectSide === "buyDepth" ? "sellDepth" : "buyDepth";

                                const goodDepthExchangeInfo = { connector: currentConnectorHasBetterDepth ? currentMarketInfo.connector : otherMarketInfo.connector, depth: currentConnectorHasBetterDepth ? currentPairDepth : otherPairDepth, side: currentConnectorCorrectSide, pairInfo: currentConnectorHasBetterDepth ? currentPair : otherPair };
                                const badDepthExchangeInfo = { connector: currentConnectorHasBetterDepth ? otherMarketInfo.connector : currentMarketInfo.connector, depth: currentConnectorHasBetterDepth ? otherPairDepth : currentPairDepth, side: otherConnectorCorrectSide, pairInfo: currentConnectorHasBetterDepth ? otherPair : currentPair };

                                updateMostPolarEntry(`${currentPair.baseCurrency}${currentPair.referenceCurrency}`, goodDepthExchangeInfo.connector, badDepthExchangeInfo.connector, goodDepthExchangeInfo.side, goodDepthExchangeInfo.pairInfo, badDepthExchangeInfo.side, badDepthExchangeInfo.pairInfo);
                            }
                        }

                        if (currentPair.referenceCurrency === otherPair.referenceCurrency) executePolarityScan();
                    }
                }
            }
        }

        return polarEntries;
    }

    // covers Floating Arbitrage trades that have been fulfilled and prunes trades that have been completed
    async processOpenTrades() {
        const newOpenTrades = [];

        await promiseMap(this._trackedOrders, async (orderInfo) => {
            for (const curveOrder of orderInfo.curveOrders) {
                const orderStatus = await orderInfo.curveExchange.orderStatus(curveOrder.id);

                const newFillAmount = curveOrder.remainingAmount - orderStatus.quantityLeft;
                if (newFillAmount === 0) continue;

                let amountNeeded = newFillAmount;
                let coverOrderCounter = 0;

                const runCover = async (coverOrders) => {
                    while (amountNeeded > 0) {
                        if (coverOrders[coverOrderCounter].remainingAmount === 0) coverOrderCounter++;

                        const amountToCover = amountNeeded < coverOrders[coverOrderCounter].remainingAmount ? amountNeeded : coverOrders[coverOrderCounter].remainingAmount;
                        await orderInfo.coverExchange.addBuyOrder(amountToCover, coverOrders[coverOrderCounter].price, orderInfo.tradingPair.referenceCurrency, orderInfo.tradingPair.baseCurrency);

                        amountNeeded -= amountToCover;
                        coverOrders[coverOrderCounter].remainingAmount -= amountToCover;
                    }

                    if (coverOrders[coverOrderCounter].remainingAmount === 0) coverOrderCounter++;

                    orderInfo.curveOrders = orderInfo.curveOrders.slice(coverOrderCounter);
                }

                // cover the fill that we just had
                await runCover(orderInfo.coverOrders);

                // if there aren't any cover orders left, it means we've fulfilled all our curve orders as well
                if (orderInfo.coverOrders.length !== 0) newOpenTrades.push(orderInfo);
            }
        });

        this._trackedOrders = newOpenTrades;
    }

    async start() {
        if (this._unfitToRun) return;

        Logger.info("FloatingArbitrage", "startup", "Caching info required for trading...", this._socketBroadcaster);
        await this.populateMarketCaches();
        Logger.success("FloatingArbitrage", "startup", "Startup complete and trading algorithm started!", this._socketBroadcaster);

        if (!this._paperTradingEnabled) await this.fitToRun();
        else this._unfitToRun = false;
    }

    /**
     * execute multiple orders on the same market concurrency
     * @param {Order[]} orders orders to be executed on a specific trading pair
     * @param {BaseProvider} connector connector to be used for order execution
     * @param {string} referenceCurrency reference currency for trading pair
     * @param {string} baseCurrency base currency for trading pair
     * @param {boolean} isBuy whether the provided orders are buy orders
     * @returns {Promise<{ success: boolean, id: string, price: number, remainingAmount: number }[]>} Order information
     */
    async executeOrders(orders, connector, referenceCurrency, baseCurrency, isBuy) {
        return (await promiseMap(
            orders,
            async order => {
                if (isBuy) return { price: order.price, remainingAmount: order.amount, ...(await connector.addBuyOrder(order.amount, order.price, referenceCurrency, baseCurrency)) }
                else return { price: order.price, remainingAmount: order.amount, ...(await connector.addSellOrder(order.amount, order.price, referenceCurrency, baseCurrency)) }
            }
        )).sort((a, b) => a.price - b.price);
    }

    /**
     * 
     * @param {PolarEntry} polarEntry 
     * @param {*} offeringToSell 
     */
    async processFloatingArbitrage(polarEntry, offeringToSell) {
        // impossible to fulfill a trade without the ability to buy or sell on a given exchange
        if (
            polarEntry.goodExchangePairInfo.buyDepthEntries.length === 0 ||
            polarEntry.goodExchangePairInfo.sellDepthEntries.length === 0 ||
            polarEntry.badExchangePairInfo.buyDepthEntries.length === 0 ||
            polarEntry.badExchangePairInfo.sellDepthEntries.length === 0
        ) return;

        const effectiveMinOrderSize = this.effectiveMinOrderSizeBaseCurrency(
            polarEntry.goodDepthExchange,
            polarEntry.badDepthExchange,
            offeringToSell,
            polarEntry.goodExchangePairInfo.referenceCurrency,
            { buyPrice: offeringToSell ? polarEntry.goodExchangePairInfo.buyDepthEntries[0].price : 0, sellPrice: offeringToSell ? 0 : polarEntry.goodExchangePairInfo.sellDepthEntries[0].price },
            { buyPrice: offeringToSell ? 0 : polarEntry.badExchangePairInfo.buyDepthEntries[0].price, sellPrice: offeringToSell ? polarEntry.goodExchangePairInfo.sellDepthEntries[0].price : 0 }
        );

        const buyingOrderBook = offeringToSell ? polarEntry.goodExchangePairInfo : polarEntry.badExchangePairInfo;
        const sellingOrderBook = offeringToSell ? polarEntry.badExchangePairInfo : polarEntry.goodExchangePairInfo;
        const coverExchange = offeringToSell ? polarEntry.badDepthExchange : polarEntry.goodDepthExchange;
        const curveExchange = offeringToSell ? polarEntry.goodDepthExchange : polarEntry.badDepthExchange;

        // this filters out order entries that we can buy without enough volume
        buyingOrderBook.buyDepthEntries = buyingOrderBook.buyDepthEntries.filter(depthEntry => depthEntry.amount >= effectiveMinOrderSize);

        if (buyingOrderBook.buyDepthEntries.length === 0) return;

        // not enough depth to cover our orders
        if (buyingOrderBook.buyDepthEntries.reduce((acc, curr) => acc + curr) < this._numCurveOrders * effectiveMinOrderSize) return;

        const curveOrders = [];
        let coverOrders = [];

        // 2-3%, initially 2%
        let markup = 1.02;
        const markupIncreaseFactor = 0.01 / this._numCurveOrders; // creep to 3% markup

        // console.log(`${buyingOrderBook.buyDepthEntries[0].price} ${sellingOrderBook.sellDepthEntries[0].price}|${sellingOrderBook.buyDepthEntries[0].price}`);
        // true if this price falls within the spread
        if (buyingOrderBook.buyDepthEntries[0].price > sellingOrderBook.sellDepthEntries[0].price && buyingOrderBook.buyDepthEntries[0].price < sellingOrderBook.buyDepthEntries[0].price) {
            // store our cover orders
            for (let i = 0; i < this._numCurveOrders; i++) {
                if (coverOrders.length === this._numCurveOrders) break;

                if (i >= buyingOrderBook.buyDepthEntries.length) return;
                const orderEntry = buyingOrderBook.buyDepthEntries[i];

                // we can keep going with this order entry if it's big enough
                if (orderEntry.amount - effectiveMinOrderSize >= effectiveMinOrderSize) i--;

                coverOrders.push({
                    amount: effectiveMinOrderSize,
                    price: orderEntry.price,
                    remainingAmount: effectiveMinOrderSize
                });
            }

            // condense orders with the same price into one order by summing quantities
            coverOrders = coverOrders.reduce((acc, curr) => {
                const foundIndex = acc.findIndex(item => item.price === curr.price);

                if (foundIndex !== -1) acc[foundIndex].amount += curr.amount;
                else acc.push(curr);

                return acc;
            }, []);

            const coverQuantityTracking = coverOrders.map(obj => ({ ...obj }));

            // store our curve orders
            while (curveOrders.length < this._numCurveOrders) {
                // we want to use the price of the nearest order that we can fulfill at min trade size to guarantee positive returns
                const applicableOrder = coverQuantityTracking.filter(x => x.amount >= effectiveMinOrderSize)[0];

                curveOrders.push({
                    amount: effectiveMinOrderSize,
                    price: applicableOrder.price * markup,
                });
                markup += markupIncreaseFactor;

                applicableOrder.amount -= effectiveMinOrderSize;
            }

            if (this._paperTradingEnabled) {
                const tradeInfo = {
                    curveOrders: curveOrders,
                    coverOrders: coverOrders,
                    curveExchange: curveExchange,
                    coverOrders: coverExchange
                };

                const recentTradeInfo = this.isRecentTrade(tradeInfo);

                if (recentTradeInfo.repeat) return;

                this.addToRecentPaperTrades(tradeInfo, 1);

                this._paperTradingMongoCollection.insertOne({
                    tradeInfo: {
                        coverOrders: coverOrders,
                        curveOrders: curveOrders
                    },
                    trade_metadata: {
                        strategy: "FloatingArbitrage",
                        coverExchange: coverExchange._name,
                        curveExchange: curveExchange._name,
                        tradingPair: `${polarEntry.goodExchangePairInfo.baseCurrency}-${polarEntry.goodExchangePairInfo.referenceCurrency}`
                    },
                    mongo_timestamp: new Date()
                });

                return;
            }

            // check to make sure the user has enough balance to put up the cover and curve orders
            const requiredCoverBalance = coverOrders.reduce((acc, curr) => acc + curr.amount);
            const requiredCurveBalance = curveOrders.reduce((acc, curr) => acc + curr.amount);

            const balances = await Promise.all([
                coverExchange.getBalance(polarEntry.goodExchangePairInfo.referenceCurrency),
                curveExchange.getBalance(polarEntry.goodExchangePairInfo.baseCurrency)
            ]);

            // failed to get the user's balance
            if (!balances[0].success || !balances[0].success) return;

            if (!balances[0].available < requiredCoverBalance || !balances[1].available < requiredCurveBalance) {
                // warn the user of not enough balance
                Logger.warning("FloatingArbitrage", "balanceCheck", "Profitable floating arbitrage trades were found, but the user didn't have enough balance to fulfill the trades", this._socketBroadcaster);
                return;
            }

            // at this point all the sanity checks are complete and we are ready to submit the trades
            const res = await this.executeOrders(curveOrders, curveExchange, polarEntry.goodExchangePairInfo.referenceCurrency, polarEntry.goodExchangePairInfo.baseCurrency, false);
            if (!res.every(x => x.success)) {
                Logger.error("FloatingArbitrage", "submitCurveOrders", "Failed to submit curve orders after sanity checks were completed. Undesired behavior may have occured. Check all exchange accounts for changes!", this._socketBroadcaster);
                return;
            }

            this._trackedOrders.push({
                coverOrders: coverOrders,
                curveOrders: res,
                coverExchange: coverExchange,
                curveExchange: curveExchange,
                tradingPair: { baseCurrency: polarEntry.goodExchangePairInfo.baseCurrency, referenceCurrency: polarEntry.goodExchangePairInfo.referenceCurrency }
            });
            Logger.success("FloatingArbitrage", "tradeCompleted", "Profitable Floating Arbitrage trade was found and submitted to exchanges!", this._socketBroadcaster);
        }
    }

    async tick() {
        this.pruneRecentPaperTrades();
        await this.processOpenTrades();

        // check if user deposited more funds to make defined inventory tradeable
        if (this._unfitToRun) {
            Logger.warning("FloatingArbitrage", "fitToRunCheck", "The trading algorithm is unfit to run, likely due to available balance on at least one exchange being lower than the defined inventory", this._socketBroadcaster);
            await sleep(10000);
            await this.fitToRun();
            return;
        }

        const polarExchangeEntries = await this.getPolarExchanges();
        const polarPairs = Object.keys(polarExchangeEntries);

        // trades that offer to sell for more or buy for less
        for (const polarPair of polarPairs) {
            await this.processFloatingArbitrage(polarExchangeEntries[polarPair], true);
            await this.processFloatingArbitrage(polarExchangeEntries[polarPair], false);
        }
    }

    async shutdown() {
        //! update this once testing is done
        //! BaseProvider.cancelAllPending() is no longer supported
        // Logger.info("FloatingArbitrage", "shutdown", "Cancelling all pending orders...", this._socketBroadcaster);
        // const statuses = await promiseMap(this._connectors, async connector => {
        //     const res = await connector.cancelAllPending();
        //     if (!res) return connector._name;

        //     return true;
        // });
        // Logger.info("FloatingArbitrage", "shutdown", `Failed to cancel pending orders in: ${statuses.every(x => x === true) ? "None (nothing left to do)" : statuses.map(x => x === true ? "" : x).join(", ")}`, this._socketBroadcaster);
        // Logger.info("FloatingArbitrage", "shutdown", "If any connectors failed to cancel pending orders, please go into your exchange's account and cancel the applicable orders manually.", this._socketBroadcaster);
        Logger.success("FloatingArbitrage", "shutdown", "Algorithm shutdown complete and trading stopped", this._socketBroadcaster);
    }
}