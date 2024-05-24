import React, {BaseSyntheticEvent} from "react";

export enum seatStatus {
    emp = "emp",
    ava = "ava",
    occ = "occ"
}

const seatColor = {
    emp : "border-red-400 text-red-400",
    ava : "border-green-400 text-green-400",
    occ : "border-blue-400 text-blue-400"
}

export interface seatProps {
    id: number,
    status: seatStatus,
    name: string,
    editor(i:number, status:seatStatus, text:string):void,
}

export const SeatButton: React.FC<seatProps> = (props) => {

    const callParent = (_status: seatStatus, _context="") => {
        if (_status === seatStatus.ava) {
            props.editor(props.id, _status, "")
        } else if (_status === seatStatus.emp) {
            props.editor(props.id, _status, "X")
        } else if (_status === seatStatus.occ) {
            props.editor(props.id, _status, _context)
        }
    }

    const ToggleStatus = (e: BaseSyntheticEvent) => {
        console.log("button", props.id, "clicked!")
        e.preventDefault();
        if (props.status === seatStatus.ava) callParent(seatStatus.emp)
        else if (props.status === seatStatus.emp) callParent(seatStatus.ava)
    }

    const dynamicClass = `${props.status} mx-1 my-1 h-8 px-2 py-2 font-bold text-center align-middle transition-all bg-transparent border-2 border-solid rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs bg-150 active:opacity-85 hover:scale-102 tracking-tight-soft bg-x-25 hover:opacity-75 ${seatColor[props.status]}`;
    console.log("rerenderimg seat", props.id)
    return (
        <button onClick={ToggleStatus} draggable="true" className={dynamicClass}>
            {props.name}
        </button>
    );
}