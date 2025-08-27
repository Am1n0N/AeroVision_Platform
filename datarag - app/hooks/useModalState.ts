import { useState } from "react";

export function useModalState() {
    const [editOpen, setEditOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const openEdit = () => setEditOpen(true);
    const closeEdit = () => setEditOpen(false);
    const openConfirm = () => setConfirmOpen(true);
    const closeConfirm = () => setConfirmOpen(false);

    return {
        editOpen,
        confirmOpen,
        openEdit,
        closeEdit,
        openConfirm,
        closeConfirm,
    };
}

