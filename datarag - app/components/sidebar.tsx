"use client";

import { cn } from "@/lib/utils";
import {Database, FileStack, Plus, TestTube} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

export const Sidebar = () => {
    const pathname = usePathname();
    const router = useRouter();

    const routes = [
        {
            icon: FileStack,
            href: "/",
            label: "Docs",
        },
        {
            icon: Plus,
            href: "/documents/new",
            label: "Create",
        },
        {
            icon: Database,
            href: "/data",
            label: "Data",
        },
         {
            icon: TestTube,
            href: "/Evaluation",
            label: "Evaluation",
        },
    ];

    const onNavigate = (url: string) => {
        return router.push(url);
    };


    return (
        <div className="space-y-4 flex flex-col h-full text-primary bg-secondary">
            <div className="p-3 flex flex-1 justify-center">
                <div className="space-y-2">
                    {routes.map((route) => (
                        <div
                            onClick={() => onNavigate(route.href)}
                            key={route.href}
                            className={cn(
                                "text-muted-foreground text-xs group flex p-3 w-full justify-start font-medium curosr-pointer hover:text-primary hover:bg-primary/10 rounded-lg transition",
                                pathname === route.href && "text-primary bg-primary/10"
                            )}>
                                <div className="flex flex-col gap-y-2 items-center flex-1">
                                    <route.icon className="h-5 w-5" />
                                    <span>{route.label}</span>
                                </div>
                        </div>))}
                </div>
            </div>
        </div>
    );
};
