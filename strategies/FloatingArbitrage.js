import Logger from "../Logger.js";
import { promisify } from 'node:util';
import Bluebird from "bluebird";
import BaseArbitrage from "./BaseArbitrage.js";

const { map: promiseMap } = Bluebird;
const sleep = promisify(setTimeout);

export default class FloatingArbitrageStrategy extends BaseArbitrage {
    _maxInvPct;
    _inventoryDefinition;
    _unfitToRun;
    _maxPriceDropPct;
    _currencyUsed;

    constructor(connectors, args) {
        super(connectors, args);
        if (!args.baseCurrency || !args.baseCurrency || !args.maxInvPct || !args.inventoryDefinition) {
            args.baseCurrency = "RTM";
            Logger.error("FloatingArbitrage", "startup", "One or more required arguments not provided", this._socketBroadcaster);
            this._unfitToRun = true;
            return;
        }

        this._maxInvPct = args.maxInvPct;
        this._inventoryDefinition = args.inventoryDefinition;

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
            const orderBookInfos = await this.baseCurrencyOrberBookInfosForConnector(connector);
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
     * @typedef {Object} TradingPairInfo
     * @property {number} buyDepth amount of coins that can be bought without shifting the price by this._maxPriceDropPct
     * @property {number} sellDepth amount of coins that can be sold without shifting the price by this._maxPriceDropPct
     * @property {string} baseCurrency Base currency of the trading pair
     * @property {string} referenceCurrency Reference currency of the trading pair
     * @property {DepthEntry[]} buyDepthEntries The relevant depth values on the buy side
     * @property {DepthEntry[]} sellDepthEntries The relevant depth values on the sell side
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
                        let correctSide = "bid";
                        if (comboAlreadyProcessed({ connector: currentMarketInfo.connector, tradingPair: currentPair }, { connector: otherMarketInfo.connector, tradingPair: otherPair })) correctSide = "ask";

                        const currentCorrectDepthKey = correctSide === "bid" ? "buyDepth" : "sellDepth";
                        const otherCorrectDepthKey = correctSide === "bid" ? "sellDepth" : "buyDepth";

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

                        if (currentPair.referenceCurrency === otherPair.referenceCurrency) {
                            executePolarityScan();
                        } else {
                            // this is where we'll need to check for conversion rates to see if it's viable
                            // then run executeFloatingArbitrage()
                        }
                    }
                }
            }
        }

        return polarEntries;
    }

    async start() {
        Logger.info("FloatingArbitrage", "startup", "Caching info required for trading...", this._socketBroadcaster);
        await this.populateMarketCaches();
        Logger.success("FloatingArbitrage", "startup", "Startup complete and trading algorithm started!", this._socketBroadcaster);
        //! re-enable soon
        // await this.fitToRun();
    }

    async tick() {
        const polarExchangeEntries = await this.getPolarExchanges();

        for (const polarPair of Object.keys(polarExchangeEntries)) {
            const polarEntry = polarExchangeEntries[polarPair];
            const goodDepthExchangeMarketSide = polarEntry.goodExchangeSide === "buyPrice" ? "bid" : "ask";
            const badDepthExchangeMarketSide = goodDepthExchangeMarketSide === "bid" ? "ask" : "bid";
            
            const badDepthExchangeAveragePrice = (polarEntry.badExchangePairInfo.buyDepthEntries[0].price + polarEntry.badExchangePairInfo.sellDepthEntries[0].price) / 2;
        //! enable this once testing is done
        // // check if user deposited more funds to make defined inventory tradeable
        // if (this._unfitToRun) {
        //     Logger.warning("FloatingArbitrage", "fitToRunCheck", "The trading algorithm is unfit to run, likely due to available balance on at least one exchange being lower than the defined inventory", this._socketBroadcaster);
        //     await sleep(10000);
        //     await this.fitToRun();
        //     return;
        // }
    }

    async shutdown() {
        //! enable this once testing is done
        // Logger.info("FloatingArbitrage", "shutdown", "Cancelling all pending orders...", this._socketBroadcaster);
        // const statuses = await promiseMap(this._connectors, async connector => {
        //     const res = await connector.cancelAllPending();
        //     if (!res) return connector._name;

        //     return true;
        // });
        // Logger.info("FloatingArbitrage", "shutdown", `Failed to cancel pending orders in: ${statuses.every(x => x === true) ? "None (nothing left to do)" : statuses.map(x => x === true ? "" : x).join(", ")}`, this._socketBroadcaster);
        // Logger.info("FloatingArbitrage", "shutdown", "If any connectors failed to cancel pending orders, please go into your exchange's account and cancel the applicable orders manually.", this._socketBroadcaster);
        // Logger.success("FloatingArbitrage", "shutdown", "Algorithm shutdown complete and algorithm stopped", this._socketBroadcaster);
    }
}