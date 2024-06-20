import {FC, DragEvent, useState, SyntheticEvent} from 'react'
import StatusBar from "./seatBar";

const gridClasses = [
    "grid-cols-1",
    "grid-cols-2",
    "grid-cols-3",
    "grid-cols-4",
    "grid-cols-5",
    "grid-cols-6",
    "grid-cols-7",
    "grid-cols-8",
    "grid-cols-9",
    "grid-cols-10",
    "grid-cols-11",
    "grid-cols-12"
];

export enum seatStatus {
    emp = "emp",
    ava = "ava",
    occ = "occ",
}

/* TODO: Ask for unwanted dialog. */
export const SeatTable: FC = () => {
    const [rowCount, setRowCount] = useState(6);
    const [colCount, setColCount] = useState(8);
    const [seatList, setSeatList] = useState(
        new Array(48).fill({status: seatStatus.ava, name: ""}));

    const resizeSeat = () => {
        const tc = parseInt((document.getElementById("col")as HTMLInputElement).value), tr = parseInt((document.getElementById("row")as HTMLInputElement).value)
        if (tc <= 0 || tr <= 0) {
            alert("欄與列必須大於零")
            return
        } else if (tc >= 12) {
            alert("輸入欄數需小於12")
            return
        } else if (tr >= 30) {
            alert("輸入列數需小於30")
            return
        }
        setColCount(tc)
        setRowCount(tr)
        console.log(tc, tr)
        setSeatList(new Array(tc * tr).fill({status: seatStatus.ava, name: ""}))
    }

    const changeSeatStatus = (i: Readonly<number>, status: Readonly<seatStatus>, text = "") => {
        setSeatList(prevSeatList => prevSeatList.map((seat, n) => {
            if (n === i) {
                if (status === seatStatus.ava) return {status: seatStatus.ava, name: ""}
                else if (status === seatStatus.emp) return {status: seatStatus.emp, name: "X"};
                else return {status: seatStatus.occ, name: text};
            }
            return seat;
        }));
    };

    const clear = () => {
        setSeatList(prevSeatList => prevSeatList.map(() => {
            return {status: seatStatus.ava, name: ""}
        }));
    }

    const inputFile = () => {
        const input = document.createElement('input');
        input.accept = '.xlsx'
        input.type = 'file'
        input.onchange = () => {
            const files = Array.from(input.files);
            if (files && files[0]) {
                phaseExcel(files[0])
            }
        };
        input.click();
    }

    const importData = (students: string[]) => {
        let cap = 0
        for (const each of seatList) {
            if (each.status == seatStatus.ava) {
                console.log(each.status + "=" + seatStatus.ava)
                cap++
            }
        }

        // check if student length more than capacities of seat
        console.log(String(cap), String(students.length))
        if (students.length > cap) {
            alert("學生數量大於座位數量! 請調整座位數量。")
            return
        }

        // get a shuffled seat list
        const seatIndex = []
        for (let i = 0; i < colCount * rowCount; i++) {
            seatIndex.push(i)
        }
        const shuffledSeatList = seatIndex.sort(() => Math.random() - 0.5)

        let i = 0
        for (const stu of students) console.log(stu)
        for (const randomIndex of shuffledSeatList) {
            if (i < students.length && seatList[randomIndex].status === seatStatus.ava) {
                changeSeatStatus(randomIndex, seatStatus.occ, students[i])
                i++
            } else {
                changeSeatStatus(randomIndex, seatStatus.emp)
            }
        }

    }

    const exportExcel = () => {
        const seats: string[][] = [];
        for (let i = 0; i < rowCount; i++) {
            seats.push([])
            for (let j = 0; j < colCount; j++) {
                seats[i].push(seatList[i * colCount + j].name)
            }
        }

        console.log(seats)

        Promise.all([
            import("xlsx"),
            import("file-saver")
        ]).then(([XLSX, fileSaver]) => {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(seats);

            // Append the worksheet to the workbook
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

            // Write the workbook to a binary string
            const wbout = XLSX.write(wb, {bookType: 'xlsx', type: 'binary'});

            const s2ab = (s: string) => {
                const buf = new ArrayBuffer(s.length);
                const view = new Uint8Array(buf);
                for (let i = 0; i < s.length; i++) {
                    view[i] = s.charCodeAt(i) & 0xFF;
                }
                return buf;
            }
            // Convert the binary string to a Blob
            const blob = new Blob([s2ab(wbout)], {type: 'application/octet-stream'});

            // Save the Blob as a file
            fileSaver.saveAs(blob, '學生座位表.xlsx');
        })

    }

    const ToggleStatus = (e: SyntheticEvent, index: number) => {
        console.log("button", index, "clicked!")
        e.preventDefault();
        if (seatList[index].status === seatStatus.ava) changeSeatStatus(index, seatStatus.emp)
        else if (seatList[index].status === seatStatus.emp) changeSeatStatus(index, seatStatus.ava)
    }

    const exchange = (sourceID: number, targetID: number) => {
        if (isNaN(sourceID)) return
        const target = seatList[targetID];
        const source = seatList[sourceID];
        setSeatList(prevSeatList => prevSeatList.map((seat, n) => {
            if (n === sourceID) {
                return target
            } else if (n === targetID) {
                return source
            }
            return seat;
        }));
        document.getElementById(String(targetID)).classList.remove("border-dashed")
        document.getElementById(String(targetID)).classList.remove("opacity-50")
        document.getElementById(String(sourceID)).classList.remove("border-opacity-50")
    }

    const phaseExcel = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e: ProgressEvent<FileReader>) => {
            // Parse data
            import("xlsx").then((XLSX) => {
                const binaryStr = e.target?.result;
                const wb = XLSX.read(binaryStr, {type: 'binary'});

                // Get first worksheet
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];

                // Convert array of arrays
                const data: [][] = XLSX.utils.sheet_to_json(ws, {header: 1});
                const flatdata: string[] = []

                for (const row of data) {
                    let stu = ""
                    for (const ele of row) {
                        stu += ele
                    }
                    flatdata.push(stu)
                }

                // Update state
                importData(flatdata)
                // Here you can handle the JSON data further
            })
        };
        reader.readAsBinaryString(file);
    }

    const DragOverAnimation = (e: DragEvent<HTMLDivElement>, targetID: number) => {
        e.preventDefault()
        if (e.nativeEvent.type == "dragover") {
            document.getElementById(String(targetID)).classList.add("border-dashed")
            document.getElementById(String(targetID)).classList.add("opacity-50")
        } else {
            document.getElementById(String(targetID)).classList.remove("border-dashed")
            document.getElementById(String(targetID)).classList.remove("opacity-50")
        }
    }

    const onDragStart = (e: DragEvent<HTMLDivElement>, targetID: number) => {
        e.dataTransfer.setData("sourceID", String(targetID))
        document.getElementById(String(targetID)).classList.add("border-opacity-50")
    }

    const onDragEnd = (selfID: number) => {
        document.getElementById(String(selfID)).classList.remove("border-opacity-50")
    }

    const dropFile = (e: DragEvent) => {
        e.preventDefault()
        try {
            if (e.dataTransfer.files[0].path.split('.').pop() !== "xlsx") {
                alert("僅支援xlsx檔!")
                return
            }
            phaseExcel(e.dataTransfer.files[0])
        } catch (error) {
            console.log("this is not a file!")
        }

        console.log(e)
        // if (document.getElementById(String(e.target.id)).classList !== null) {
        //     document.getElementById(String(e.target.id)).classList.remove("border-dashed")
        //     document.getElementById(String(e.target.id)).classList.remove("opacity-50")
        // }
    }

    return (
        <>
            <div className="mt-4 w-full px-6 flex flex-wrap">
                {/* seat card */}
                <div className="w-full max-w-full pb-1 pl-0">
                    <div className="flex flex-row -mx-3 pb-2">
                        {/* text */}
                        <div className="flex flex-col flex-none w-fit px-3">
                            <p className="select-none text-[#EDF0F4] font-medium text-[14px] leading-[130%] pb-[8px]">學生座位預覽</p>
                            <p className="select-none text-[#ACB4C0] font-normal text-[14px] leading-[130%]">在此修改並匯出學生座位。</p>
                        </div>

                        {/* Button */}
                        <div className="flex flex-row-reverse w-full px-3 text-right">
                            <button
                                className="functionalButton"
                                onClick={inputFile}>匯入學生
                            </button>
                            <button
                                className="functionalButton" onClick={() => {
                                    document.getElementById("openAskDialog").click()
                                }}>生成座位
                            </button>
                            <button
                                className="functionalButton disabled:border-0 disabled:text-gray-700" onClick={clear} disabled={seatList.filter((seat) => {return seat.status !== seatStatus.ava}).length == 0}>清空座位
                            </button>
                            <button id="secondGeneration" className="Hidden" onClick={resizeSeat}></button>
                            <button onClick={exportExcel} disabled={seatList.filter((seat) => {return seat.status !== seatStatus.ava}).length == 0}
                                    className="functionalButton disabled:border-0 disabled:text-gray-700">匯出座位
                            </button>
                        </div>
                    </div>
                </div>
                <div onDrop={dropFile} onDragOver={(e) => {e.preventDefault()}}
                    className={"bg-[#23283D] border-[#444B5F] border rounded-[16px] p-[24px] grid w-full " + gridClasses[colCount - 1]}
                    >
                    {seatList.map((seat, i) => (
                        <div draggable className={`${seatList[i].status}`} key={String(i)}
                             onClick={(e:SyntheticEvent) => {ToggleStatus(e, i)}} id={String(i)}
                             onDragStart={(e) => {onDragStart(e, i)}}
                             onDragOver={(e) => {DragOverAnimation(e, i)}}
                             onDragLeave={(e) => {DragOverAnimation(e, i)}}
                             onDragEnd={() => onDragEnd(i)}
                             onDrop={(e) => {exchange(parseInt(e.dataTransfer.getData("sourceID")), i)}}>
                                {seat.name}
                        </div>
                    ))}
                </div>
                <StatusBar
                    blueNum={seatList.filter((x) => {
                        return x.status == seatStatus.occ
                    }).length}
                    greenNum={seatList.filter((x) => {
                        return x.status == seatStatus.ava
                    }).length}
                    redNum={seatList.filter((x) => {
                        return x.status == seatStatus.emp
                    }).length}
                />
            </div>
        </>
    )
}