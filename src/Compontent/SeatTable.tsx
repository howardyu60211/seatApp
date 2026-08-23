import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { DragEvent, FormEvent, useState } from "react";
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

const DEFAULT_ROW_COUNT = 6;
const DEFAULT_COL_COUNT = 8;
const MAX_ROW_COUNT = 29;
const MAX_COL_COUNT = 11;

const createSeat = (status = seatStatus.ava, name = ""): Seat => ({
  status,
  name: status === seatStatus.emp ? "X" : name,
});

const createSeatList = (count: number) =>
  Array.from({ length: count }, () => createSeat());

const shuffle = <T,>(values: T[]) => {
  for (let i = values.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [values[i], values[randomIndex]] = [values[randomIndex], values[i]];
  }
  return values;
};

export const SeatTable = () => {
  const [rowCount, setRowCount] = useState(DEFAULT_ROW_COUNT);
  const [colCount, setColCount] = useState(DEFAULT_COL_COUNT);
  const [seatList, setSeatList] = useState<Seat[]>(() =>
    createSeatList(DEFAULT_ROW_COUNT * DEFAULT_COL_COUNT),
  );
  const [isResizeOpen, setIsResizeOpen] = useState(false);
  const [requestedRowCount, setRequestedRowCount] = useState(
    String(DEFAULT_ROW_COUNT),
  );
  const [requestedColCount, setRequestedColCount] = useState(
    String(DEFAULT_COL_COUNT),
  );

  const openResizeDialog = () => {
    setRequestedRowCount(String(rowCount));
    setRequestedColCount(String(colCount));
    setIsResizeOpen(true);
  };

  const resizeSeat = (event: FormEvent<HTMLFormElement>) => {
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

    setColCount(nextColCount);
    setRowCount(nextRowCount);
    setSeatList(createSeatList(nextColCount * nextRowCount));
    setIsResizeOpen(false);
  };

  const changeSeatStatus = (
    i: Readonly<number>,
    status: Readonly<seatStatus>,
    text = "",
  ) => {
    setSeatList((previousSeats) => {
      if (!previousSeats[i]) return previousSeats;

      const nextSeats = [...previousSeats];
      nextSeats[i] = createSeat(status, text);
      return nextSeats;
    });
  };

  const clear = () => {
    setSeatList((previousSeats) => createSeatList(previousSeats.length));
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

    setSeatList(nextSeats);
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

  const toggleSeatStatus = (index: number) => {
    if (seatList[index].status === seatStatus.ava)
      changeSeatStatus(index, seatStatus.emp);
    else if (seatList[index].status === seatStatus.emp)
      changeSeatStatus(index, seatStatus.ava);
  };

  const exchange = (sourceID: number, targetID: number) => {
    if (!Number.isInteger(sourceID) || sourceID === targetID) return;

    setSeatList((previousSeats) => {
      if (!previousSeats[sourceID] || !previousSeats[targetID]) {
        return previousSeats;
      }

      const nextSeats = [...previousSeats];
      [nextSeats[sourceID], nextSeats[targetID]] = [
        nextSeats[targetID],
        nextSeats[sourceID],
      ];
      return nextSeats;
    });
  };

  const parseExcel = (file: File) => {
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
        const students = rows
          .map((row) => row.map(String).join(" ").trim())
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
            <div className="flex flex-row-reverse w-full px-3 text-right">
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
                匯出座位
              </button>
            </div>
          </div>
        </div>
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
    </>
  );
};
