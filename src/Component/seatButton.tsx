/* TODO: Migrating class to function */
import React, {BaseSyntheticEvent, Component} from "react";

export interface seatProps {
    onClick?: (e: React.BaseSyntheticEvent) => void,
    id: string,
    draggable?: string,
    status: seatStatus,
    key: string,
    name: string,
    editor(i:number, status:seatStatus, text:string):void,
}

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

export class SeatButton extends Component<seatProps> {
    constructor(props: seatProps) {
        super(props);
        this.ToggleStatus = this.ToggleStatus.bind(this);
    }

    callParent = (_status: seatStatus, _context="") => {
        if (_status === seatStatus.ava) {
            this.props.editor(parseInt(this.props.id), _status, "")
        } else if (_status === seatStatus.emp) {
            this.props.editor(parseInt(this.props.id), _status, "X")
        } else if (_status === seatStatus.occ) {
            this.props.editor(parseInt(this.props.id), _status, _context)
        }
    }

    ToggleStatus = (e: BaseSyntheticEvent) => {
        console.log("button", this.props.id, "clicked!")
        e.preventDefault();
        if (this.props.status === seatStatus.ava) this.callParent(seatStatus.emp)
        else if (this.props.status === seatStatus.emp) this.callParent(seatStatus.ava)
    }

    shouldComponentUpdate(nextProps: Readonly<seatProps>): boolean {
        return nextProps.status !== this.props.status || nextProps.name !== this.props.name;

    }

    render() {
        console.log("rendering button", this.props.id)
        const draggable = this.props.draggable == "True" || this.props.draggable == "true"
        const dynamicClass = this.props.status + " mx-1 my-1 h-8 px-2 py-2 font-bold text-center align-middle transition-all bg-transparent border-2 border-solid rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs bg-150 active:opacity-85 hover:scale-102 tracking-tight-soft bg-x-25 hover:opacity-75 "

        return (
            <button onClick={this.ToggleStatus} draggable={draggable} className={dynamicClass + seatColor[this.props.status]}>
                {this.props.name}
            </button>
        );
    }
}