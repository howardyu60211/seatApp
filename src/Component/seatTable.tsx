import * as React from 'react'
import {Component} from 'react'
import {SeatButton, seatStatus} from "./seatButton";

import * as XLSX from "xlsx";
import {saveAs} from "file-saver";
import {StatusBar} from "./statusBar";

interface SeatTableState {
    seatStatusList: seatStatus[],
    seatNameList: string[],
    r: number,
    c: number
}

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

export class SeatTable extends Component<NonNullable<unknown>, SeatTableState> {

    constructor(props: NonNullable<unknown>) {
        super(props)
        this.state = {
            r: 6,
            c: 8,
            seatStatusList: new Array(8 * 6).fill(seatStatus.ava),
            seatNameList: new Array(8 * 6).fill("")
        }
        this.importExcel = this.importExcel.bind(this)
        this.exportExcel = this.exportExcel.bind(this)
    }


    resizeSeat = () => {
        const tc = parseInt((document.getElementById("col")as HTMLInputElement).value), tr = parseInt((document.getElementById("row")as HTMLInputElement).value)
        if (tc <= 0 || tr <= 0) {
            alert("欄與列必須大於零")
            return
        }

        if (tc >= 12) {
            alert("輸入欄數需小於12")
            return
        }

        if (tr >= 30) {
            alert("輸入列數需小於30")
            return
        }



        if (!this.isEmpty()) {
            if (!confirm("您有尚未儲存的座位表，是否重新生成座位?")) {
                return
            }
        }

        this.setState({c: tc, r: tr,
            seatStatusList: new Array(tc * tr).fill(seatStatus.ava),
            seatNameList: new Array(tc * tr).fill("")})
        console.log(this.state.c, this.state.r)
    }

    isEmpty () {
        let changed = false
        for (const eachStatus of this.state.seatStatusList) {
            if (eachStatus !== seatStatus.ava) {
                changed = true
                break
            }
        }
        return !changed
    }

    changeSeatStatus = (i: number, status: seatStatus, text = "") => {
        console.log("seatTable changeStatus[" + i + "] to", status, text);
        this.setState(prevState => {
            const newStatusList = [...prevState.seatStatusList];
            newStatusList[i] = status;
            const newNameList = [...prevState.seatNameList];
            if (status === seatStatus.ava) newNameList[i] = "";
            else if (status === seatStatus.emp) newNameList[i] = "X";
            else newNameList[i] = text
            return {seatStatusList: newStatusList, seatNameList: newNameList};
        })
    }

    clear () {
        for (let i=0; i<this.state.seatStatusList.length; i++) {
            this.changeSeatStatus(i, seatStatus.ava)
        }
    }

    importExcel() {
        const input = document.createElement('input');
        input.accept ='.xlsx'
        input.type = 'file'
        input.onchange = () => {
            const files = Array.from(input.files);
            if (files && files[0]) {
                const file = files[0];
                const reader = new FileReader();
                reader.onload = (e: ProgressEvent<FileReader>) => {
                    // Parse data
                    const binaryStr = e.target?.result;
                    const wb = XLSX.read(binaryStr, { type: 'binary' });

                    // Get first worksheet
                    const wsname = wb.SheetNames[0];
                    const ws = wb.Sheets[wsname];

                    // Convert array of arrays
                    const data:[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
                    const flatdata:string[] = []

                    for (const row of data) {
                        let stu = ""
                        for(const ele of row) {
                            stu += ele
                        }
                        flatdata.push(stu)
                    }

                    // Update state
                    console.log("data", data);
                    this.phaseExcel(flatdata)
                    // Here you can handle the JSON data further
                };
                reader.readAsBinaryString(file);
            }
        };
        input.click();
    }

    phaseExcel = (students: string[]) => {
        let cap = 0
        for (const i of this.state.seatStatusList) {
            if (i == seatStatus.ava) {
                console.log(i + "=" + seatStatus.ava)
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
        const seatList = []
        for (let i = 0; i < this.state.c * this.state.r; i++) {
            seatList.push(i)
        }
        const shuffledSeatList = seatList.sort(() => Math.random() - 0.5)

        let i = 0
        for (const stu of students) console.log(stu)
        for (const randomIndex of shuffledSeatList) {
            if (i < students.length && this.state.seatStatusList[randomIndex] === seatStatus.ava) {
                this.changeSeatStatus(randomIndex, seatStatus.occ, students[i])
                console.log("set", randomIndex, "to", students[i])
                i++
            } else {
                this.changeSeatStatus(randomIndex, seatStatus.emp)
                console.log("set", randomIndex, "to empty")
            }
        }

    }

    async exportExcel() {
        const seats: string[][] = [];
        for (let i = 0; i < this.state.r; i++) {
            seats.push([])
            for (let j = 0; j < this.state.c; j++) {
                seats[i].push(this.state.seatNameList[i * this.state.c + j])
            }
        }

        console.log(seats)

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(seats);

        // Append the worksheet to the workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

        // Write the workbook to a binary string
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });

        const s2ab = (s: string) => {
            const buf = new ArrayBuffer(s.length);
            const view = new Uint8Array(buf);
            for (let i = 0; i < s.length; i++) {
                view[i] = s.charCodeAt(i) & 0xFF;
            }
            return buf;
        };

        // Convert the binary string to a Blob
        const blob = new Blob([s2ab(wbout)], { type: 'application/octet-stream' });

        // Save the Blob as a file
        saveAs(blob, '學生座位表.xlsx');
    }

    render() {
        const seat = []
        for (let i = 0; i < this.state.c; i++) {
            for (let j = 0; j < this.state.r; j++) {
                const cur = i * this.state.r + j
                seat.push(<SeatButton key={String(cur)} id={String(cur)} draggable="true" editor={this.changeSeatStatus}
                                      status={this.state.seatStatusList[cur]}
                                      name={this.state.seatNameList[cur]}></SeatButton>)
            }
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
                                    className="select-none h-11 px-4 ml-1 mb-0 font-bold text-center uppercase align-middle transition-all bg-transparent border border-solid rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs duration-100 bg-150 active:opacity-85 hover:scale-102 tracking-tight-soft bg-x-25 border-opacity-0 hover:border-opacity-100 border-fuchsia-500 text-fuchsia-500"
                                    onClick={this.importExcel}>匯入學生
                                </button>
                                <button
                                    className="select-none h-11 px-4 mx-1 mb-0 font-bold text-center uppercase align-middle transition-all bg-transparent border border-solid rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs duration-100 bg-150 active:opacity-85 hover:scale-102 tracking-tight-soft bg-x-25 border-opacity-0 hover:border-opacity-100 border-fuchsia-500 text-fuchsia-500"
                                    onClick={() => {
                                        document.getElementById("openAskDialog").click()
                                    }}>生成座位
                                </button>
                                <button
                                    className="select-none h-11 px-4 mx-1 mb-0 font-bold text-center uppercase align-middle transition-all bg-transparent border border-solid rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs duration-100 bg-150 active:opacity-85 hover:scale-102 tracking-tight-soft bg-x-25 border-opacity-0 hover:border-opacity-100 border-fuchsia-500 text-fuchsia-500 disabled:border-opacity-0 disabled:text-gray-700"
                                    onClick={() => {this.clear()}} disabled={this.isEmpty()}>清空座位
                                </button>
                                <button id="secondGeneration" className="Hidden" onClick={this.resizeSeat}></button>
                                <button onClick={this.exportExcel} disabled={this.isEmpty()}
                                        className="select-none h-11 px-4 mx-1 mb-0 font-bold text-center uppercase align-middle transition-all bg-transparent border border-solid rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs duration-100 bg-150 active:opacity-85 hover:scale-102 tracking-tight-soft bg-x-25 border-opacity-0 hover:border-opacity-100 border-fuchsia-500 text-fuchsia-500 disabled:border-opacity-0 disabled:text-gray-700">匯出座位
                                </button>
                            </div>
                        </div>
                    </div>
                    <div
                        className={"bg-[#23283D] border-[#444B5F] border rounded-[16px] p-[24px] grid w-full " + gridClasses[this.state.c - 1]}
                        id="seat">
                        {seat}
                    </div>
                    <StatusBar
                        blueNum={this.state.seatStatusList.filter((x) => {
                            return x == seatStatus.occ
                        }).length}
                        greenNum={this.state.seatStatusList.filter((x) => {
                            return x == seatStatus.ava
                        }).length}
                        redNum={this.state.seatStatusList.filter((x) => {
                            return x == seatStatus.emp}).length}
                            >
                            </StatusBar>
                </div>
            </>
        )
    }
}