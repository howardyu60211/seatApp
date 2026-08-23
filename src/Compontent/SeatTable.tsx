import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type SubmitEvent,
} from "react";
import {
  exportSeatLayoutAsPdf,
  exportSeatLayoutAsPng,
} from "./seatExport";
import StatusBar from "./seatBar";

export enum seatStatus {
  emp = "emp",
  ava = "ava",
  occ = "occ",
}

interface Seat {
  status: seatStatus;
  name: string;
}

interface SeatLayout {
  rowCount: number;
  colCount: number;
  seats: Seat[];
}

interface SeatHistoryEntry extends SeatLayout {
  id: string;
  name: string;
  createdAt: number;
}

interface OperationNotice {
  message: string;
}

type StoredSeatHistoryEntry = Omit<SeatHistoryEntry, "name"> & {
  name?: unknown;
};

type ImportFormatMode = "join-row" | "selected-columns";

const DEFAULT_ROW_COUNT = 6;
const DEFAULT_COL_COUNT = 8;
const MAX_ROW_COUNT = 29;
const MAX_COL_COUNT = 11;
const MAX_HISTORY_COUNT = 30;
const MAX_UNDO_COUNT = 50;
const HISTORY_STORAGE_KEY = "seatapp.favorite-seat-layouts.v1";

const createSeat = (status = seatStatus.ava, name = ""): Seat => ({
  status,
  name: status === seatStatus.emp ? "X" : name,
});

const createSeatList = (count: number) =>
  Array.from({ length: count }, () => createSeat());

const isSeat = (value: unknown): value is Seat => {
  if (!value || typeof value !== "object") return false;

  const seat = value as Partial<Seat>;
  return (
    typeof seat.name === "string" &&
    Object.values(seatStatus).includes(seat.status as seatStatus)
  );
};

const loadSeatHistory = (): SeatHistoryEntry[] => {
  try {
    const storedHistory = JSON.parse(
      localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]",
    ) as unknown;

    if (!Array.isArray(storedHistory)) return [];

    return storedHistory
      .filter((entry): entry is StoredSeatHistoryEntry => {
        if (!entry || typeof entry !== "object") return false;

        const historyEntry = entry as Partial<StoredSeatHistoryEntry>;
        const { rowCount, colCount, seats } = historyEntry;
        return (
          typeof historyEntry.id === "string" &&
          typeof historyEntry.createdAt === "number" &&
          typeof rowCount === "number" &&
          Number.isInteger(rowCount) &&
          rowCount > 0 &&
          rowCount <= MAX_ROW_COUNT &&
          typeof colCount === "number" &&
          Number.isInteger(colCount) &&
          colCount > 0 &&
          colCount <= MAX_COL_COUNT &&
          Array.isArray(seats) &&
          seats.length === rowCount * colCount &&
          seats.every(isSeat)
        );
      })
      .map((entry) => ({
        ...entry,
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : "未命名座位",
      }))
      .slice(0, MAX_HISTORY_COUNT);
  } catch {
    return [];
  }
};

const createSeatLayout = (
  rowCount: number,
  colCount: number,
  seats: Seat[],
): SeatLayout => ({
  rowCount,
  colCount,
  seats: seats.map((seat) => ({ ...seat })),
});

const createHistoryEntry = (
  name: string,
  rowCount: number,
  colCount: number,
  seats: Seat[],
): SeatHistoryEntry => {
  const createdAt = Date.now();
  return {
    ...createSeatLayout(rowCount, colCount, seats),
    id: `${createdAt}-${Math.random().toString(36).slice(2)}`,
    name,
    createdAt,
  };
};

const persistSeatHistory = (history: SeatHistoryEntry[]) => {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // The in-memory history remains usable if local storage is unavailable.
  }
};

const parseImportColumns = (value: string) => {
  const tokens = value.split(/[,，\s]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const columns = tokens.map(Number);
  if (columns.some((column) => !Number.isInteger(column) || column < 1)) {
    return null;
  }

  return [...new Set(columns)];
};

const shuffle = <T,>(values: T[]) => {
  for (let i = values.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [values[i], values[randomIndex]] = [values[randomIndex], values[i]];
  }
  return values;
};

export const SeatTable = () => {
  const [initialSeatHistory] = useState(loadSeatHistory);
  const [initialSeatLayout] = useState<SeatLayout>(() =>
    initialSeatHistory[0]
      ? createSeatLayout(
          initialSeatHistory[0].rowCount,
          initialSeatHistory[0].colCount,
          initialSeatHistory[0].seats,
        )
      : createSeatLayout(
          DEFAULT_ROW_COUNT,
          DEFAULT_COL_COUNT,
          createSeatList(DEFAULT_ROW_COUNT * DEFAULT_COL_COUNT),
        ),
  );
  const [rowCount, setRowCount] = useState(initialSeatLayout.rowCount);
  const [colCount, setColCount] = useState(initialSeatLayout.colCount);
  const [seatList, setSeatList] = useState<Seat[]>(() =>
    initialSeatLayout.seats.map((seat) => ({ ...seat })),
  );
  const [isResizeOpen, setIsResizeOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDeleteAllHistoryConfirming, setIsDeleteAllHistoryConfirming] =
    useState(false);
  const [seatHistory, setSeatHistory] =
    useState<SeatHistoryEntry[]>(initialSeatHistory);
  const [favoriteName, setFavoriteName] = useState("");
  const [operationNotice, setOperationNotice] =
    useState<OperationNotice | null>(null);
  const [isOperationNoticeVisible, setIsOperationNoticeVisible] =
    useState(false);
  const [undoStack, setUndoStack] = useState<SeatLayout[]>([]);
  const [redoStack, setRedoStack] = useState<SeatLayout[]>([]);
  const [requestedRowCount, setRequestedRowCount] = useState(
    String(DEFAULT_ROW_COUNT),
  );
  const [requestedColCount, setRequestedColCount] = useState(
    String(DEFAULT_COL_COUNT),
  );
  const [importFormatMode, setImportFormatMode] =
    useState<ImportFormatMode>("join-row");
  const [importSeparator, setImportSeparator] = useState(" ");
  const [importColumns, setImportColumns] = useState("1,2");
  const [skipFirstRow, setSkipFirstRow] = useState(false);
  const [exportTitle, setExportTitle] = useState("學生座位表");
  const [showExportPodium, setShowExportPodium] = useState(false);

  const formatImportedRow = (row: unknown[]) => {
    const cells =
      importFormatMode === "selected-columns"
        ? (parseImportColumns(importColumns) ?? []).map(
            (column) => row[column - 1],
          )
        : row;

    return cells
      .map((cell) => String(cell ?? ""))
      .join(importSeparator)
      .trim();
  };

  const separatorDescription =
    importSeparator === ""
      ? "不分隔"
      : /^ +$/.test(importSeparator)
        ? `${importSeparator.length} 個空白`
        : `「${importSeparator}」`;
  const importPreview =
    formatImportedRow(["A01", "王小明", "三年甲班"]) ||
    "（空白，不會匯入）";

  const showOperationNotice = useCallback((message: string) => {
    setOperationNotice({ message });
  }, []);

  useEffect(() => {
    if (!operationNotice) return;

    setIsOperationNoticeVisible(true);
    const timeoutId = window.setTimeout(
      () => setIsOperationNoticeVisible(false),
      2400,
    );
    return () => window.clearTimeout(timeoutId);
  }, [operationNotice]);

  const replaceSeatLayout = useCallback((layout: SeatLayout) => {
    setRowCount(layout.rowCount);
    setColCount(layout.colCount);
    setSeatList(layout.seats.map((seat) => ({ ...seat })));
  }, []);

  const applySeatLayout = useCallback(
    (nextRowCount: number, nextColCount: number, nextSeats: Seat[]) => {
      const currentLayout = createSeatLayout(rowCount, colCount, seatList);
      const nextLayout = createSeatLayout(
        nextRowCount,
        nextColCount,
        nextSeats,
      );

      setUndoStack((previousStack) =>
        [...previousStack, currentLayout].slice(-MAX_UNDO_COUNT),
      );
      setRedoStack([]);
      replaceSeatLayout(nextLayout);
    },
    [colCount, replaceSeatLayout, rowCount, seatList],
  );

  const undoSeatLayout = useCallback(() => {
    const previousLayout = undoStack.at(-1);
    if (!previousLayout) return;

    const currentLayout = createSeatLayout(rowCount, colCount, seatList);
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((previousStack) =>
      [...previousStack, currentLayout].slice(-MAX_UNDO_COUNT),
    );
    replaceSeatLayout(previousLayout);
    showOperationNotice("復原成功");
  }, [
    colCount,
    replaceSeatLayout,
    rowCount,
    seatList,
    showOperationNotice,
    undoStack,
  ]);

  const redoSeatLayout = useCallback(() => {
    const nextLayout = redoStack.at(-1);
    if (!nextLayout) return;

    const currentLayout = createSeatLayout(rowCount, colCount, seatList);
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((previousStack) =>
      [...previousStack, currentLayout].slice(-MAX_UNDO_COUNT),
    );
    replaceSeatLayout(nextLayout);
    showOperationNotice("重做成功");
  }, [
    colCount,
    redoStack,
    replaceSeatLayout,
    rowCount,
    seatList,
    showOperationNotice,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey && undoStack.length > 0) {
        event.preventDefault();
        undoSeatLayout();
      } else if (key === "y" && !event.shiftKey && redoStack.length > 0) {
        event.preventDefault();
        redoSeatLayout();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redoSeatLayout, redoStack.length, undoSeatLayout, undoStack.length]);

  const saveSeatLayout = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = favoriteName.trim();
    if (!name) return;

    const historyEntry = createHistoryEntry(
      name,
      rowCount,
      colCount,
      seatList,
    );
    setSeatHistory((previousHistory) => {
      const nextHistory = [historyEntry, ...previousHistory].slice(
        0,
        MAX_HISTORY_COUNT,
      );
      persistSeatHistory(nextHistory);
      return nextHistory;
    });
    setFavoriteName("");
    showOperationNotice(`已收藏「${name}」`);
  };

  const deleteSeatHistory = (historyEntry: SeatHistoryEntry) => {
    if (!confirm(`確定要刪除「${historyEntry.name}」嗎？`)) return;

    setSeatHistory((previousHistory) => {
      const nextHistory = previousHistory.filter(
        (entry) => entry.id !== historyEntry.id,
      );
      persistSeatHistory(nextHistory);
      return nextHistory;
    });
    showOperationNotice(`已刪除「${historyEntry.name}」`);
  };

  const deleteAllSeatHistory = () => {
    setSeatHistory([]);
    persistSeatHistory([]);
    setIsDeleteAllHistoryConfirming(false);
    showOperationNotice("已刪除全部座位紀錄");
  };

  const closeSeatHistory = () => {
    setIsHistoryOpen(false);
    setIsDeleteAllHistoryConfirming(false);
  };

  const restoreSeatLayout = (historyEntry: SeatHistoryEntry) => {
    applySeatLayout(
      historyEntry.rowCount,
      historyEntry.colCount,
      historyEntry.seats,
    );
    closeSeatHistory();
    showOperationNotice(`已還原「${historyEntry.name}」`);
  };

  const openResizeDialog = () => {
    setRequestedRowCount(String(rowCount));
    setRequestedColCount(String(colCount));
    setIsResizeOpen(true);
  };

  const resizeSeat = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextColCount = Number(requestedColCount);
    const nextRowCount = Number(requestedRowCount);

    if (
      !Number.isInteger(nextColCount) ||
      !Number.isInteger(nextRowCount) ||
      nextColCount <= 0 ||
      nextRowCount <= 0
    ) {
      alert("欄與列必須大於零");
      return;
    }
    if (nextColCount > MAX_COL_COUNT) {
      alert("輸入欄數需小於12");
      return;
    }
    if (nextRowCount > MAX_ROW_COUNT) {
      alert("輸入列數需小於30");
      return;
    }

    applySeatLayout(
      nextRowCount,
      nextColCount,
      createSeatList(nextColCount * nextRowCount),
    );
    setIsResizeOpen(false);
  };

  const changeSeatStatus = (
    i: Readonly<number>,
    status: Readonly<seatStatus>,
    text = "",
  ) => {
    if (!seatList[i]) return;

    const nextSeats = [...seatList];
    nextSeats[i] = createSeat(status, text);
    applySeatLayout(rowCount, colCount, nextSeats);
  };

  const clear = () => {
    applySeatLayout(
      rowCount,
      colCount,
      createSeatList(seatList.length),
    );
  };

  const inputFile = () => {
    const input = document.createElement("input");
    input.accept = ".xlsx";
    input.type = "file";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) parseExcel(file);
    };
    input.click();
  };

  const importData = (students: string[]) => {
    const capacity = seatList.reduce(
      (count, seat) => count + Number(seat.status === seatStatus.ava),
      0,
    );

    if (students.length > capacity) {
      alert("學生數量大於座位數量! 請調整座位數量。");
      return;
    }

    const shuffledSeatIndexes = shuffle(
      seatList.map((_, seatIndex) => seatIndex),
    );
    const nextSeats = seatList.map(() => createSeat(seatStatus.emp));
    let studentIndex = 0;

    for (const seatIndex of shuffledSeatIndexes) {
      if (
        studentIndex < students.length &&
        seatList[seatIndex].status === seatStatus.ava
      ) {
        nextSeats[seatIndex] = createSeat(
          seatStatus.occ,
          students[studentIndex],
        );
        studentIndex++;
      }
    }

    applySeatLayout(rowCount, colCount, nextSeats);
  };

  const exportExcel = async () => {
    const seats: string[][] = [];
    for (let i = 0; i < rowCount; i++) {
      seats.push([]);
      for (let j = 0; j < colCount; j++) {
        seats[i].push(seatList[i * colCount + j].name);
      }
    }

    try {
      const [XLSX, { saveAs }] = await Promise.all([
        import("xlsx"),
        import("file-saver"),
      ]);
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(seats);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

      const workbookData = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
      });
      const blob = new Blob([workbookData], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      saveAs(blob, "學生座位表.xlsx");
    } catch {
      alert("匯出座位表失敗，請稍後再試。");
    }
  };

  const exportImage = async () => {
    try {
      await exportSeatLayoutAsPng(
        { rowCount, colCount, seats: seatList },
        { title: exportTitle, showPodium: showExportPodium },
      );
      showOperationNotice("已匯出 PNG 圖片");
    } catch {
      alert("匯出 PNG 圖片失敗，請稍後再試。");
    }
  };

  const exportPdf = async () => {
    try {
      await exportSeatLayoutAsPdf(
        { rowCount, colCount, seats: seatList },
        { title: exportTitle, showPodium: showExportPodium },
      );
      showOperationNotice("已匯出 PDF");
    } catch {
      alert("匯出 PDF 失敗，請稍後再試。");
    }
  };

  const toggleSeatStatus = (index: number) => {
    if (seatList[index].status === seatStatus.ava)
      changeSeatStatus(index, seatStatus.emp);
    else if (seatList[index].status === seatStatus.emp)
      changeSeatStatus(index, seatStatus.ava);
  };

  const exchange = (sourceID: number, targetID: number) => {
    if (!Number.isInteger(sourceID) || sourceID === targetID) return;

    if (!seatList[sourceID] || !seatList[targetID]) return;

    const nextSeats = [...seatList];
    [nextSeats[sourceID], nextSeats[targetID]] = [
      nextSeats[targetID],
      nextSeats[sourceID],
    ];
    applySeatLayout(rowCount, colCount, nextSeats);
  };

  const parseExcel = (file: File) => {
    if (
      importFormatMode === "selected-columns" &&
      !parseImportColumns(importColumns)
    ) {
      alert("請輸入有效的欄位編號，例如 1,2,4。");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      if (!(event.target?.result instanceof ArrayBuffer)) return;

      try {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(event.target.result, { type: "array" });
        const worksheetName = workbook.SheetNames[0];
        if (!worksheetName) {
          alert("Excel 檔案中沒有可讀取的工作表。");
          return;
        }

        const rows = XLSX.utils.sheet_to_json<unknown[]>(
          workbook.Sheets[worksheetName],
          { header: 1 },
        );
        const rowsToImport = skipFirstRow ? rows.slice(1) : rows;
        const students = rowsToImport
          .map(formatImportedRow)
          .filter(Boolean);

        if (students.length === 0) {
          alert("Excel 檔案中沒有學生資料。");
          return;
        }
        importData(students);
      } catch {
        alert("無法讀取 Excel 檔案，請確認檔案格式是否正確。");
      }
    };
    reader.onerror = () => alert("無法讀取選取的檔案。");
    reader.readAsArrayBuffer(file);
  };

  const handleSeatDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.classList.add("border-dashed", "opacity-50");
  };

  const handleSeatDragStart = (
    event: DragEvent<HTMLDivElement>,
    seatIndex: number,
  ) => {
    event.dataTransfer.setData("sourceID", String(seatIndex));
    event.currentTarget.classList.add("border-status-dim");
  };

  const handleSeatDrop = (
    event: DragEvent<HTMLDivElement>,
    targetIndex: number,
  ) => {
    event.preventDefault();
    event.currentTarget.classList.remove("border-dashed", "opacity-50");
    const sourceID = event.dataTransfer.getData("sourceID");
    if (!sourceID) return;

    event.stopPropagation();
    exchange(Number(sourceID), targetIndex);
  };

  const dropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      alert("僅支援 xlsx 檔!");
      return;
    }

    parseExcel(file);
  };

  const seatCounts = seatList.reduce(
    (counts, seat) => {
      counts[seat.status]++;
      return counts;
    },
    {
      [seatStatus.ava]: 0,
      [seatStatus.occ]: 0,
      [seatStatus.emp]: 0,
    },
  );
  const hasSeatChanges = seatCounts[seatStatus.ava] !== seatList.length;

  return (
    <>
      <div className="mt-4 w-full px-6 flex flex-wrap">
        {/* seat card */}
        <div className="w-full max-w-full pb-1 pl-0">
          <div className="flex flex-row -mx-3 pb-2">
            {/* text */}
            <div className="flex flex-col flex-none w-fit px-3">
              <p className="select-none text-[#EDF0F4] font-medium text-[14px] leading-[130%] pb-[8px]">
                學生座位預覽
              </p>
              <p className="select-none text-[#ACB4C0] font-normal text-[14px] leading-[130%]">
                在此修改並匯出學生座位。
              </p>
            </div>

            {/* Button */}
            <div className="flex w-full flex-row-reverse flex-wrap px-3 text-right">
              <button className="functionalButton" onClick={inputFile}>
                匯入學生
              </button>
              <button
                className="functionalButton"
                onClick={openResizeDialog}
              >
                生成座位
              </button>
              <button
                className="functionalButton disabled:border-transparent disabled:text-gray-700"
                onClick={clear}
                disabled={!hasSeatChanges}
              >
                清空座位
              </button>
              <button
                onClick={exportExcel}
                disabled={!hasSeatChanges}
                className="functionalButton disabled:border-transparent disabled:text-gray-700"
              >
                匯出 XLSX
              </button>
              <button
                onClick={exportPdf}
                disabled={!hasSeatChanges}
                className="functionalButton disabled:border-transparent disabled:text-gray-700"
              >
                匯出 PDF
              </button>
              <button
                onClick={exportImage}
                disabled={!hasSeatChanges}
                className="functionalButton disabled:border-transparent disabled:text-gray-700"
              >
                匯出 PNG
              </button>
            </div>
          </div>
        </div>

        <section
          aria-label="座位收藏與紀錄"
          className="mb-3 w-full rounded-[14px] border border-[#444B5F] bg-[#1C2133] p-4"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <form
              onSubmit={saveSeatLayout}
              className="flex min-w-0 flex-1 items-end gap-2"
            >
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-xs font-medium text-[#ACB4C0]">
                  收藏名稱
                </span>
                <input
                  type="text"
                  value={favoriteName}
                  maxLength={40}
                  onChange={(event) => setFavoriteName(event.target.value)}
                  placeholder="例如：三年甲班期中座位"
                  required
                  className="block h-10 w-full rounded-lg border border-[#596178] bg-[#23283D] px-3 text-sm text-[#EDF0F4] outline-none transition placeholder:text-[#6F778A] focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/20"
                />
              </label>
              <button
                type="submit"
                disabled={!favoriteName.trim()}
                className="h-10 shrink-0 rounded-lg border border-fuchsia-400 px-3 text-xs font-bold text-fuchsia-400 transition hover:bg-fuchsia-400/10 disabled:cursor-not-allowed disabled:border-[#596178] disabled:text-[#6F778A]"
              >
                ☆ 收藏
              </button>
            </form>

            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="h-10 shrink-0 rounded-lg border border-[#596178] bg-[#23283D] px-3 text-xs font-bold text-[#EDF0F4] transition hover:border-fuchsia-400 hover:text-fuchsia-400"
            >
              座位紀錄（{seatHistory.length}）
            </button>
          </div>
        </section>

        <details className="group mb-3 w-full overflow-hidden rounded-[14px] border border-[#444B5F] bg-[#1C2133]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.16em] text-fuchsia-400 uppercase">
                匯出設定
              </p>
              <p className="mt-1 truncate text-sm text-[#ACB4C0]">
                {exportTitle.trim() || "學生座位表"} ·
                {showExportPodium ? " 顯示講臺" : " 不顯示講臺"}
              </p>
            </div>
            <span
              aria-hidden="true"
              className="text-lg text-fuchsia-400 transition-transform duration-200 group-open:rotate-180"
            >
              ⌄
            </span>
          </summary>

          <div className="grid grid-cols-1 gap-4 border-t border-[#444B5F] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[#ACB4C0]">
                匯出標題
              </span>
              <input
                type="text"
                value={exportTitle}
                maxLength={40}
                onChange={(event) => setExportTitle(event.target.value)}
                placeholder="學生座位表"
                className="block w-full rounded-lg border border-[#596178] bg-[#23283D] px-3 py-2 text-sm text-[#EDF0F4] outline-none transition placeholder:text-[#6F778A] focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/20"
              />
              <span className="mt-1 block text-[11px] text-[#7F8798]">
                套用至 PNG 與 PDF；留空時使用「學生座位表」。
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#444B5F] bg-[#23283D]/70 px-3 py-2.5">
              <input
                type="checkbox"
                checked={showExportPodium}
                onChange={(event) => setShowExportPodium(event.target.checked)}
                className="size-4 accent-fuchsia-500"
              />
              <span>
                <span className="block text-sm text-[#EDF0F4]">列印講臺</span>
                <span className="block text-[11px] text-[#7F8798]">
                  顯示在座位表上方。
                </span>
              </span>
            </label>
          </div>
        </details>

        <details className="group mb-3 w-full overflow-hidden rounded-[14px] border border-[#444B5F] bg-[#1C2133]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.16em] text-fuchsia-400 uppercase">
                XLSX 匯入格式
              </p>
              <p className="mt-1 truncate text-sm text-[#ACB4C0]">
                {importFormatMode === "join-row"
                  ? `合併整列 · ${separatorDescription}`
                  : `組合欄位 ${importColumns || "—"} · ${separatorDescription}`}
                {skipFirstRow ? " · 略過標題列" : ""}
              </p>
            </div>
            <span
              aria-hidden="true"
              className="text-lg text-fuchsia-400 transition-transform duration-200 group-open:rotate-180"
            >
              ⌄
            </span>
          </summary>

          <div className="grid grid-cols-1 gap-4 border-t border-[#444B5F] px-4 py-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[#ACB4C0]">
                資料列輸出方式
              </span>
              <select
                value={importFormatMode}
                onChange={(event) =>
                  setImportFormatMode(event.target.value as ImportFormatMode)
                }
                className="block w-full rounded-lg border border-[#596178] bg-[#23283D] px-3 py-2 text-sm text-[#EDF0F4] outline-none transition focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/20"
              >
                <option value="join-row">合併整列</option>
                <option value="selected-columns">組合指定欄位</option>
              </select>
            </label>

            {importFormatMode === "selected-columns" && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-[#ACB4C0]">
                  選取欄位與順序
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={importColumns}
                  onChange={(event) => setImportColumns(event.target.value)}
                  placeholder="例如：1,2,4"
                  className="block w-full rounded-lg border border-[#596178] bg-[#23283D] px-3 py-2 text-sm text-[#EDF0F4] outline-none transition placeholder:text-[#6F778A] focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/20"
                />
                <span className="mt-1 block text-[11px] text-[#7F8798]">
                  以逗號分隔；Excel 的 A 欄是第 1 欄。
                </span>
              </label>
            )}

            <label
              className={
                importFormatMode === "join-row"
                  ? "block sm:col-span-2"
                  : "block"
              }
            >
              <span className="mb-1.5 block text-xs font-medium text-[#ACB4C0]">
                欄位分隔字元
              </span>
              <input
                type="text"
                value={importSeparator}
                maxLength={12}
                onChange={(event) => setImportSeparator(event.target.value)}
                placeholder="留空代表直接相接"
                className="block w-full rounded-lg border border-[#596178] bg-[#23283D] px-3 py-2 text-sm text-[#EDF0F4] outline-none transition placeholder:text-[#6F778A] focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/20"
              />
              <span className="mt-1 block text-[11px] text-[#7F8798]">
                目前：{separatorDescription}
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#444B5F] bg-[#23283D]/70 px-3 py-2.5 sm:col-span-3">
              <input
                type="checkbox"
                checked={skipFirstRow}
                onChange={(event) => setSkipFirstRow(event.target.checked)}
                className="size-4 accent-fuchsia-500"
              />
              <span>
                <span className="block text-sm text-[#EDF0F4]">
                  略過第一列
                </span>
                <span className="block text-[11px] text-[#7F8798]">
                  Excel 第一列是姓名、班級等欄位標題時啟用。
                </span>
              </span>
            </label>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/5 px-3 py-2.5 sm:col-span-3">
              <span className="text-xs font-medium text-fuchsia-300">
                範例：A01、王小明、三年甲班
              </span>
              <code className="truncate text-right text-sm text-[#EDF0F4]">
                {importPreview}
              </code>
            </div>
          </div>
        </details>

        <div
          onDrop={dropFile}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          className={
            "bg-[#23283D] border-[#444B5F] border rounded-[16px] p-[24px] grid w-full "
          }
          style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
        >
          {seatList.map((seat, i) => (
            <div
              draggable
              className={seat.status}
              key={String(i)}
              onClick={() => toggleSeatStatus(i)}
              onDragStart={(event) => handleSeatDragStart(event, i)}
              onDragOver={handleSeatDragOver}
              onDragLeave={(event) =>
                event.currentTarget.classList.remove(
                  "border-dashed",
                  "opacity-50",
                )
              }
              onDragEnd={(event) =>
                event.currentTarget.classList.remove("border-status-dim")
              }
              onDrop={(event) => handleSeatDrop(event, i)}
            >
              {seat.name}
            </div>
          ))}
        </div>
        <StatusBar
          occupiedCount={seatCounts[seatStatus.occ]}
          availableCount={seatCounts[seatStatus.ava]}
          unavailableCount={seatCounts[seatStatus.emp]}
        />
      </div>

      <Transition show={isResizeOpen}>
        <Dialog
          as="div"
          className="relative z-10 focus:outline-none"
          onClose={() => setIsResizeOpen(false)}
        >
          <div className="fixed inset-0 z-10 w-screen overflow-y-auto bg-black/30">
            <div className="flex min-h-full items-center justify-center p-4">
              <TransitionChild
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="w-full max-w-md rounded-xl bg-[#23283D] p-6 shadow-xl">
                  <DialogTitle
                    as="h3"
                    className="select-none text-base/7 font-medium text-[#EDF0F4]"
                  >
                    座位大小
                  </DialogTitle>
                  <form onSubmit={resizeSeat}>
                    <label
                      htmlFor="seat-column-count"
                      className="select-none block text-sm font-medium leading-6 text-[#ACB4C0] my-2"
                    >
                      欄數量：
                    </label>
                    <input
                      id="seat-column-count"
                      name="columnCount"
                      type="number"
                      min={1}
                      max={MAX_COL_COUNT}
                      step={1}
                      value={requestedColCount}
                      onChange={(event) =>
                        setRequestedColCount(event.target.value)
                      }
                      required
                      autoFocus
                      className="block w-full rounded-md border-0 p-1.5 text-gray-900 shadow-xs ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                    />

                    <label
                      htmlFor="seat-row-count"
                      className="select-none block text-sm font-medium leading-6 text-[#ACB4C0] my-2"
                    >
                      列數量：
                    </label>
                    <input
                      id="seat-row-count"
                      name="rowCount"
                      type="number"
                      min={1}
                      max={MAX_ROW_COUNT}
                      step={1}
                      value={requestedRowCount}
                      onChange={(event) =>
                        setRequestedRowCount(event.target.value)
                      }
                      required
                      className="block w-full rounded-md border-0 p-1.5 text-gray-900 shadow-xs ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                    />

                    <button
                      type="submit"
                      className="flex w-full justify-center rounded-md bg-indigo-600 mt-4 px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-xs hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                    >
                      生成
                    </button>
                  </form>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>

      <Transition show={isHistoryOpen}>
        <Dialog
          as="div"
          className="relative z-10 focus:outline-none"
          onClose={closeSeatHistory}
        >
          <div className="fixed inset-0 z-10 w-screen overflow-y-auto bg-black/30">
            <div className="flex min-h-full items-center justify-center p-4">
              <TransitionChild
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="w-full max-w-xl rounded-xl bg-[#23283D] p-6 shadow-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <DialogTitle
                        as="h3"
                        className="select-none text-base/7 font-medium text-[#EDF0F4]"
                      >
                        座位紀錄
                      </DialogTitle>
                      <p className="mt-1 text-xs text-[#ACB4C0]">
                        顯示你主動收藏的座位配置，最多 {MAX_HISTORY_COUNT} 筆。
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {seatHistory.length > 0 &&
                        !isDeleteAllHistoryConfirming && (
                          <button
                            type="button"
                            onClick={() =>
                              setIsDeleteAllHistoryConfirming(true)
                            }
                            className="rounded-lg border border-red-400/70 px-3 py-1.5 text-sm font-medium text-red-400 transition hover:bg-red-400/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                          >
                            全部刪除
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={closeSeatHistory}
                        className="rounded-lg px-3 py-1.5 text-sm text-[#ACB4C0] transition hover:bg-white/5 hover:text-[#EDF0F4]"
                      >
                        關閉
                      </button>
                    </div>
                  </div>

                  {isDeleteAllHistoryConfirming ? (
                    <div
                      role="alert"
                      className="mt-5 rounded-lg border border-red-400/40 bg-red-400/5 p-4"
                    >
                      <p className="text-sm font-medium text-[#EDF0F4]">
                        刪除全部 {seatHistory.length} 筆座位紀錄？
                      </p>
                      <p className="mt-1 text-xs text-[#ACB4C0]">
                        刪除後無法復原，但不會影響目前畫面上的座位。
                      </p>
                      <div className="mt-4 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setIsDeleteAllHistoryConfirming(false)
                          }
                          className="rounded-lg px-3 py-2 text-xs font-bold text-[#ACB4C0] transition hover:bg-white/5 hover:text-[#EDF0F4]"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={deleteAllSeatHistory}
                          className="rounded-lg border border-red-400 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                        >
                          確認全部刪除
                        </button>
                      </div>
                    </div>
                  ) : seatHistory.length === 0 ? (
                    <div className="mt-5 rounded-lg border border-dashed border-[#596178] px-4 py-8 text-center text-sm text-[#ACB4C0]">
                      尚無紀錄。請輸入收藏名稱並收藏目前配置。
                    </div>
                  ) : (
                    <div className="mt-5 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                      {seatHistory.map((historyEntry) => {
                        const occupiedCount = historyEntry.seats.reduce(
                          (count, seat) =>
                            count + Number(seat.status === seatStatus.occ),
                          0,
                        );

                        return (
                          <div
                            key={historyEntry.id}
                            className="flex items-center justify-between gap-4 rounded-lg border border-[#444B5F] bg-[#1C2133] px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[#EDF0F4]">
                                {historyEntry.name}
                              </p>
                              <p className="mt-1 text-xs text-[#7F8798]">
                                {new Date(
                                  historyEntry.createdAt,
                                ).toLocaleString("zh-TW")} · {historyEntry.rowCount}
                                列 × {historyEntry.colCount} 欄 · 已分配 {occupiedCount}
                                人
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  deleteSeatHistory(historyEntry)
                                }
                                className="rounded-lg border border-red-400/70 px-3 py-2 text-xs font-bold text-red-400 transition hover:bg-red-400/10 active:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                              >
                                刪除
                              </button>
                              <button
                                type="button"
                                onClick={() => restoreSeatLayout(historyEntry)}
                                className="rounded-lg border border-fuchsia-400 px-3 py-2 text-xs font-bold text-fuchsia-400 transition hover:bg-fuchsia-400/10 active:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
                              >
                                還原
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>

      <Transition
        show={isOperationNoticeVisible}
        enter="transition ease-out duration-200"
        enterFrom="translate-y-2 opacity-0"
        enterTo="translate-y-0 opacity-100"
        leave="transition ease-in duration-150"
        leaveFrom="translate-y-0 opacity-100"
        leaveTo="translate-y-2 opacity-0"
      >
        <div
          role="status"
          aria-live="polite"
          className="fixed right-5 bottom-5 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-green-400/30 bg-[#1C2133]/95 px-4 py-3 text-sm font-medium text-[#EDF0F4] shadow-2xl backdrop-blur"
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-400/15 text-xs text-green-400"
          >
            ✓
          </span>
          <span>{operationNotice?.message}</span>
        </div>
      </Transition>
    </>
  );
};
