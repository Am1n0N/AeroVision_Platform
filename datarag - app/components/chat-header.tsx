"use client";

import { Document, Message } from "@prisma/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ChevronLeft, Edit, MessagesSquare, MoreVertical, Trash } from "lucide-react";
import { Button } from "./ui/button";
import axios from "axios";
import { useToast } from "./ui/use-toast";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { BotAvatar } from "./bot-avatar";

interface ChatHeaderProps {
    document: Document & {messages: Message[]; _count: {messages: number}};
}

export const ChatHeader = ({document}:ChatHeaderProps) => {
    const router = useRouter();
    const { user } = useUser();
    const { toast } = useToast();
  
    const onDelete = async () => {
      try {
        await axios.delete(`/api/document/${document.id}`);
        toast({
          description: "Success."
        });
        router.refresh();
        router.push("/");
      } catch (error) {
        toast({
          variant: "destructive",
          description: "Something went wrong."
        })
      }
    }
    return (
        <div className="flex w-full justify-between items-center border-b border-primary/10 pb-4">
          <div className="flex gap-x-2 items-center">
            <Button onClick={() => router.back()} size="icon" variant="ghost">
              <ChevronLeft className="h-8 w-8" />
            </Button>
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center gap-x-2">
                <p className="font-bold">{document.title}</p>
                <div className="flex pl-2 items-center text-xs text-muted-foreground">
                  <MessagesSquare className="w-3 h-3 mr-1" />
                  {document._count.messages}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Created by {document.createdBy}
              </p>
            </div>
          </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/documents/${document.id}`)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete}>
                  <Trash className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
      );
}