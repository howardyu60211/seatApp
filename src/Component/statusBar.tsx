/* TODO: Migrating class to function */
import React, {Component} from "react";

interface barProps {
    blueNum: number,
    greenNum: number,
    redNum: number,
    children?: React.ReactNode
}

export class StatusBar extends Component<barProps> {
    constructor(props: barProps) {
        super(props);
    }

    render() {
        return (<div className="select-none py-2 flex flex-row-reverse w-full text-sm">
            <div className="text-right px-2 text-red-400">不可分配: {this.props.redNum}</div>
            <div className="text-right px-2 text-blue-400">已分配: {this.props.blueNum}</div>
            <div className="text-right px-2 text-green-400">可分配: {this.props.greenNum}</div>
        </div>)
    }

}