import {SeatTable} from "./Component/seatTable";
import {Button, Dialog, DialogPanel, DialogTitle, Transition, TransitionChild} from "@headlessui/react";
import React, {useState} from "react";
import * as appInfo from "../package.json"

export default function Index() {
    const [isOpen, setIsOpen] = useState(false)

    function open() {
        setIsOpen(true)
    }

    function close() {
        setIsOpen(false)
    }

    function handleGeneration() {
        close()
        document.getElementById("secondGeneration").click()
    }

    return (
        <>
            {/* header */}
            <div className="border-[#444B5F] border-b w-full h-16 flex items-center px-6">
                <h4 className="select-none titleBar font-bold w-3/4 text-[#EDF0F4] flex-1 h-full content-center">學生座位編排程式 v{appInfo.version}</h4>
                <button
                    className="select-none inline-block h-11 px-4 mx-1 mb-0 font-bold text-center uppercase align-middle transition-all bg-transparent border border-solid border-amber-100 rounded-lg shadow-none cursor-pointer leading-pro ease-soft-in text-xs bg-150 duration-100 active:opacity-85 hover:scale-102 tracking-tight-soft border-opacity-0 hover:border-opacity-100 bg-x-25 text-amber-100 text-[14px]" onClick={() => window.close()}>關閉程式
                </button>
            </div>

            {/* alert */}
            <div id="alert"></div>

            <Button className="hidden" onClick={open} id="openAskDialog"></Button>

            {/* resize table */}
            <Transition show={isOpen}>
                <Dialog as="div" className="relative z-10 focus:outline-none" onClose={close}>
                    <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
                        <div className="flex min-h-full items-center justify-center p-4">
                            <TransitionChild
                                enter="ease-out duration-300"
                                enterFrom="opacity-0 transform-[scale(95%)]"
                                enterTo="opacity-100 transform-[scale(100%)]"
                                leave="ease-in duration-200"
                                leaveFrom="opacity-100 transform-[scale(100%)]"
                                leaveTo="opacity-0 transform-[scale(95%)]"
                            >
                                <DialogPanel className="w-full max-w-md rounded-xl bg-white/5 p-6 backdrop-blur-2xl">
                                    <DialogTitle as="h3" className="select-none text-base/7 font-medium text-[#EDF0F4]">
                                        座位大小
                                    </DialogTitle>
                                    <div>
                                        <label className="select-none block text-sm font-medium leading-6 text-[#ACB4C0] my-2">
                                            欄數量 :
                                        </label>
                                        <div className="mt-2">
                                            <input
                                                id="col"
                                                name="col"
                                                type="number"
                                                defaultValue={8}
                                                required
                                                className="block w-full rounded-md border-0 p-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="select-none block text-sm font-medium leading-6 text-[#ACB4C0] my-2">
                                            列數量 :
                                        </label>
                                        <div className="mt-2">
                                            <input
                                                id="row"
                                                name="row"
                                                type="number"
                                                defaultValue={6}
                                                required
                                                className="block w-full rounded-md border-0 p-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <button type="submit" onClick={handleGeneration}
                                                className="flex w-full justify-center rounded-md bg-indigo-600 mt-4 px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
                                            生成
                                        </button>
                                    </div>
                                </DialogPanel>
                            </TransitionChild>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            <SeatTable></SeatTable>
        </>
    )
}