import { useState, useEffect } from "react";
import axios from "axios";
// import { format } from "date-fns";
import { FaSearch, FaHistory, FaCog, FaChartLine } from "react-icons/fa";

interface Transaction {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  blockNumber: string;
  isError: string;
}

interface TokenTransfer {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
}

interface TradeRecord {
  hash: string;
  timeStamp: string;
  type: "buy" | "sell";
  amount: number;
  token: string;
  usdtAmount: number;
}

interface CacheData {
  transactions: Transaction[];
  lastUpdate: number;
}

interface TransactionCache {
  [address: string]: CacheData;
}

function App() {
  const [address, setAddress] = useState("");
  const [txCount, setTxCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showPNL, setShowPNL] = useState(false);
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>([]);
  const [totalPNL, setTotalPNL] = useState<number>(0);
  const [totalBuyAmount, setTotalBuyAmount] = useState<number>(0);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem("bscscanApiKey") || "";
  });
  const [history, setHistory] = useState<string[]>(() => {
    const saved = localStorage.getItem("addressHistory");
    return saved ? JSON.parse(saved) : [];
  });

  const [txCache, setTxCache] = useState<TransactionCache>(() => {
    const saved = localStorage.getItem("txCache");
    return saved ? JSON.parse(saved) : {};
  });

  const TARGET_ADDRESS =
    "0xb300000b72DEAEb607a12d5f54773D1C19c7028d".toLowerCase();
  const USDT_CONTRACT =
    "0x55d398326f99059ff775485246999027b3197955".toLowerCase();

  useEffect(() => {
    localStorage.setItem("addressHistory", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("txCache", JSON.stringify(txCache));
  }, [txCache]);

  useEffect(() => {
    localStorage.setItem("bscscanApiKey", apiKey);
  }, [apiKey]);

  const getBlockNumberByTimestamp = async (
    timestamp: number
  ): Promise<number> => {
    if (!apiKey) {
      throw new Error("请先设置 BSCScan API Key");
    }

    try {
      const response = await axios.get(`https://api.bscscan.com/api`, {
        params: {
          module: "block",
          action: "getblocknobytime",
          timestamp: timestamp,
          closest: "before",
          apikey: apiKey,
        },
      });

      if (response.data.status === "1") {
        return parseInt(response.data.result);
      }
      throw new Error("获取区块号失败");
    } catch (err) {
      throw new Error("获取区块号失败");
    }
  };

  const getTokenTransfers = async (
    addressLower: string,
    startBlock: number
  ): Promise<TokenTransfer[]> => {
    const response = await axios.get(`https://api.bscscan.com/api`, {
      params: {
        module: "account",
        action: "tokentx",
        address: addressLower,
        startblock: startBlock,
        endblock: 99999999,
        page: 1,
        offset: 1000,
        sort: "desc",
        apikey: apiKey,
      },
    });

    if (response.data.status === "1") {
      return response.data.result as TokenTransfer[];
    }
    return [];
  };

  const calculateVolumeLevel = (totalVolume: number): number => {
    if (totalVolume < 2) return 0;
    
    let level = 1;
    let threshold = 2;
    
    while (totalVolume >= threshold && level < 20) { // 限制最大档位防止无限循环
      level++;
      threshold *= 2;
    }
    
    return level - 1;
  };

  const calculatePNL = (
    transfers: TokenTransfer[],
    transactions: Transaction[]
  ): { records: TradeRecord[]; pnl: number; buyAmount: number; volumeLevel: number } => {
    const records: TradeRecord[] = [];
    let totalBuy = 0;
    let totalSell = 0;

    // 获取与目标地址交互的交易哈希
    const targetTxHashes = new Set(
      transactions
        .filter(
          (tx) =>
            tx.to.toLowerCase() === TARGET_ADDRESS ||
            tx.from.toLowerCase() === TARGET_ADDRESS
        )
        .map((tx) => tx.hash)
    );

    // 过滤相关的 token 转账
    const relevantTransfers = transfers.filter(
      (transfer) =>
        targetTxHashes.has(transfer.hash) &&
        transfer.contractAddress.toLowerCase() === USDT_CONTRACT
    );

    relevantTransfers.forEach((transfer) => {
      const amount =
        parseFloat(transfer.value) /
        Math.pow(10, parseInt(transfer.tokenDecimal));

      if (
        transfer.from.toLowerCase() === address.toLowerCase() &&
        transfer.to.toLowerCase() === TARGET_ADDRESS
      ) {
        // 买入交易 - 用户向目标地址转 USDT
        totalBuy += amount;
        records.push({
          hash: transfer.hash,
          timeStamp: transfer.timeStamp,
          type: "buy",
          amount,
          token: transfer.tokenSymbol,
          usdtAmount: amount,
        });
      } else if (
        transfer.from.toLowerCase() === TARGET_ADDRESS &&
        transfer.to.toLowerCase() === address.toLowerCase()
      ) {
        // 卖出交易 - 目标地址向用户转 USDT
        totalSell += amount;
        records.push({
          hash: transfer.hash,
          timeStamp: transfer.timeStamp,
          type: "sell",
          amount,
          token: transfer.tokenSymbol,
          usdtAmount: amount,
        });
      }
    });

    // 按时间排序
    records.sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));

    const totalVolume = totalBuy + totalSell;
    const volumeLevel = calculateVolumeLevel(totalVolume);

    return {
      records,
      pnl: totalSell - totalBuy,
      buyAmount: totalBuy,
      volumeLevel,
    };
  };

  const handleSearch = async () => {
    if (!apiKey) {
      setError("请先设置 BSCScan API Key");
      setShowSettings(true);
      return;
    }

    if (!address) {
      setError("请输入地址");
      return;
    }

    setLoading(true);
    setError("");
    setTxCount(null);
    setTradeRecords([]);
    setTotalPNL(0);
    setTotalBuyAmount(0);
    setVolumeLevel(0);

    try {
      const today = new Date();
      const startTimestamp = Math.floor(today.setHours(8, 0, 0, 0) / 1000);
      const endTimestamp = Math.floor(today.setHours(23, 59, 59, 999) / 1000);

      const startBlock = await getBlockNumberByTimestamp(startTimestamp);
      const addressLower = address.toLowerCase();
      const cachedData = txCache[addressLower];

      let transactions: Transaction[] = [];
      let lastBlock = startBlock;

      if (cachedData) {
        transactions = cachedData.transactions;
        lastBlock = Math.max(
          ...transactions.map((tx) => parseInt(tx.blockNumber))
        );
      }

      const response = await axios.get(`https://api.bscscan.com/api`, {
        params: {
          module: "account",
          action: "txlist",
          address: addressLower,
          startblock: startBlock,
          endblock: 99999999,
          page: 1,
          offset: 1000,
          sort: "desc",
          apikey: apiKey,
        },
      });

      if (response.data.status === "1") {
        const newTransactions = response.data.result as Transaction[];
        const allTransactions = [...newTransactions, ...transactions];
        const uniqueTransactions = Array.from(
          new Map(allTransactions.map((tx) => [tx.hash, tx])).values()
        );
        transactions = uniqueTransactions;
      } else {
        throw new Error("获取数据失败");
      }

      setTxCache((prev) => ({
        ...prev,
        [addressLower]: {
          transactions,
          lastUpdate: Date.now(),
        },
      }));

      const todayTxs = transactions.filter((tx) => {
        const txTimestamp = parseInt(tx.timeStamp);
        return (
          txTimestamp >= startTimestamp &&
          txTimestamp <= endTimestamp &&
          tx.isError === "0" &&
          (tx.to.toLowerCase() === TARGET_ADDRESS ||
            tx.from.toLowerCase() === TARGET_ADDRESS)
        );
      });

      setTxCount(todayTxs.length);

      // 获取 token 转账记录并计算 PNL
      if (todayTxs.length > 0) {
        const tokenTransfers = await getTokenTransfers(
          addressLower,
          startBlock
        );
        const todayTransfers = tokenTransfers.filter((transfer) => {
          const transferTimestamp = parseInt(transfer.timeStamp);
          return (
            transferTimestamp >= startTimestamp &&
            transferTimestamp <= endTimestamp
          );
        });

        const { records, pnl, buyAmount, volumeLevel } = calculatePNL(todayTransfers, todayTxs);
        setTradeRecords(records);
        setTotalPNL(pnl);
        setTotalBuyAmount(buyAmount);
        setVolumeLevel(volumeLevel);
      }

      if (!history.includes(address)) {
        setHistory((prev) => [address, ...prev].slice(0, 5));
      }
    } catch (err) {
      setError("请求出错");
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(parseInt(timestamp) * 1000).toLocaleTimeString();
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">BSC 交易统计</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setShowPNL(!showPNL)}
              className="p-2 text-gray-600 hover:text-gray-800"
              title="PNL 分析"
            >
              <FaChartLine className="text-xl" />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-gray-600 hover:text-gray-800"
            >
              <FaCog className="text-xl" />
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-2">设置</h2>
            <div className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  BSCScan API Key
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入 BSCScan API Key"
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div className="text-xs text-gray-500">
                在{" "}
                <a
                  href="https://bscscan.com/apis"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  BSCScan
                </a>{" "}
                获取 API Key
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="输入 EVM 地址"
              className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base truncate"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-blue-300 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <FaSearch />
            {loading ? "查询中..." : "查询"}
          </button>
        </div>

        {error && <div className="text-red-500 text-center">{error}</div>}

        {txCount !== null && (
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-gray-600">今日交易数</p>
                <p className="text-2xl font-bold text-blue-500">{txCount}</p>
              </div>
              {totalBuyAmount > 0 && (
                <div>
                  <p className="text-gray-600">买入数量</p>
                  <p className="text-2xl font-bold text-orange-500">
                    {totalBuyAmount.toFixed(2)} USDT
                  </p>
                </div>
              )}
              {volumeLevel > 0 && (
                <div>
                  <p className="text-gray-600">交易量档位</p>
                  <p className="text-2xl font-bold text-purple-500">
                    {volumeLevel} 分
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {showPNL && tradeRecords.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <FaChartLine />
              PNL 分析
            </h2>
            <div className="mb-4">
              <div
                className={`text-2xl font-bold ${
                  totalPNL >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                {totalPNL >= 0 ? "+" : ""}
                {totalPNL.toFixed(6)} USDT
              </div>
              <div className="text-sm text-gray-500">总盈亏</div>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tradeRecords.map((record, index) => (
                <div key={index} className="p-2 bg-gray-50 rounded text-sm">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          record.type === "buy"
                            ? "bg-red-100 text-red-600"
                            : "bg-green-100 text-green-600"
                        }`}
                      >
                        {record.type === "buy" ? "买入" : "卖出"}
                      </span>
                      <span className="font-medium">
                        {record.usdtAmount.toFixed(6)} {record.token}
                      </span>
                    </div>
                    <div className="text-gray-500">
                      {formatTimestamp(record.timeStamp)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-1 truncate">
                    {record.hash}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow w-full">
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <FaHistory />
              历史记录
            </h2>
            <div className="space-y-2 w-full">
              {history.map((addr, index) => (
                <div
                  key={index}
                  className="p-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100 truncate"
                  onClick={() => setAddress(addr)}
                >
                  {addr}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
