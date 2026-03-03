
-- Allow users to delete their own conversations
CREATE POLICY "Users delete own conversations"
ON public.conversations
FOR DELETE
USING (auth.uid() = user_id);

-- Allow users to delete messages in their own conversations
CREATE POLICY "Users delete own messages"
ON public.messages
FOR DELETE
USING (auth.uid() = user_id);

-- Allow users to delete their own tool_runs
CREATE POLICY "Users delete own tool_runs"
ON public.tool_runs
FOR DELETE
USING (auth.uid() = user_id);
