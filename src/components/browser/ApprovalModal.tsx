import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert } from "lucide-react";

interface ApprovalModalProps {
  approval: {
    id: string;
    action_id: string;
    action: {
      action_type: string;
      parameters: Record<string, unknown>;
    };
  };
  onApprove: (actionId: string) => void;
  onReject: (actionId: string, reason: string) => void;
}

export function ApprovalModal({ approval, onApprove, onReject }: ApprovalModalProps) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(true);

  const sensitiveLabels: Record<string, string> = {
    click: "Click action",
    type: "Typing text",
    navigate: "Navigation",
    submit: "Form submission",
    download: "File download",
    delete: "Delete action",
    send: "Send action",
    login: "Login attempt",
  };

  const label = sensitiveLabels[approval.action.action_type] || approval.action.action_type;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="w-5 h-5" />
            Approval Required
          </DialogTitle>
          <DialogDescription>
            The browser agent wants to perform a sensitive action. Review and approve or reject.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="bg-muted rounded-lg p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Action</span>
              <span className="text-sm font-mono font-semibold">{label}</span>
            </div>
            {Object.entries(approval.action.parameters).map(([key, val]) => (
              <div key={key} className="flex justify-between">
                <span className="text-xs text-muted-foreground">{key}</span>
                <span className="text-xs font-mono truncate max-w-[200px]">
                  {typeof val === "string" ? val : JSON.stringify(val)}
                </span>
              </div>
            ))}
          </div>

          <Textarea
            placeholder="Reason for rejection (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="resize-none"
            rows={2}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onReject(approval.action_id, reason);
              setOpen(false);
            }}
          >
            Reject
          </Button>
          <Button
            variant="default"
            onClick={() => {
              onApprove(approval.action_id);
              setOpen(false);
            }}
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
