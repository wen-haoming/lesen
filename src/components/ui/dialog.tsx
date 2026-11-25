import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

/** 优先挂到 #reader-portal（阅读器壳内）；找不到再退回 document.body */
function getReaderPortalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  return document.getElementById("reader-portal") ?? undefined;
}

function DialogPortal({ children, ...props }: ComponentProps<typeof DialogPrimitive.Portal>) {
  // 同步读取壳内门户，避免首帧落到 document.body（大视口 web 预览会跑出壳）
  return (
    <DialogPrimitive.Portal container={getReaderPortalContainer()} {...props}>
      {children}
    </DialogPrimitive.Portal>
  );
}

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        // absolute：相对 #reader-portal；动效与官网 Dialog Overlay 一致（fade）
        "absolute inset-0 z-40 bg-black/40 pointer-events-auto",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  overlayClassName,
  closeClassName,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  closeClassName?: string;
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        className={cn(
          // 布局仍适配扩展壳；动效对齐官网：fade + zoom，duration-200
          "absolute left-1/2 top-[6%] z-50 flex max-h-[min(88%,560px)] w-[min(calc(100%-20px),396px)] -translate-x-1/2 flex-col gap-0 rounded-2xl border border-border bg-popover p-[15px] outline-none pointer-events-auto duration-200",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            "absolute right-3 top-3 grid size-6 place-items-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            closeClassName,
          )}
        >
          <X className="size-3.5" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-3 flex flex-col gap-1 pr-6", className)} {...props} />;
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[12.5px] font-bold tracking-wide", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-[11px] leading-[1.55] text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
};
