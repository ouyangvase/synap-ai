export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ad_insights_daily: {
        Row: {
          ad_account_id: string
          ad_id: string | null
          adset_id: string | null
          campaign_id: string | null
          clicks: number | null
          conversions: number | null
          cpc: number | null
          cpm: number | null
          created_at: string
          ctr: number | null
          date_start: string
          date_stop: string
          frequency: number | null
          id: string
          impressions: number | null
          leads: number | null
          raw_data: Json | null
          reach: number | null
          roas: number | null
          spend: number | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          ad_account_id: string
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date_start: string
          date_stop: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          leads?: number | null
          raw_data?: Json | null
          reach?: number | null
          roas?: number | null
          spend?: number | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          ad_account_id?: string
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date_start?: string
          date_stop?: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          leads?: number | null
          raw_data?: Json | null
          reach?: number | null
          roas?: number | null
          spend?: number | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_insights_daily_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_insights_daily_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "meta_ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_insights_daily_adset_id_fkey"
            columns: ["adset_id"]
            isOneToOne: false
            referencedRelation: "meta_adsets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_insights_daily_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "meta_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tools: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          tool_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          tool_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tools_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tools_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          model: string
          name: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          model?: string
          name: string
          system_prompt?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          model?: string
          name?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      browser_actions: {
        Row: {
          action_type: string
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          parameters: Json
          result: Json | null
          screenshot_url: string | null
          session_id: string
          status: string
          task_id: string
          user_id: string
        }
        Insert: {
          action_type: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          parameters?: Json
          result?: Json | null
          screenshot_url?: string | null
          session_id: string
          status?: string
          task_id: string
          user_id: string
        }
        Update: {
          action_type?: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          parameters?: Json
          result?: Json | null
          screenshot_url?: string | null
          session_id?: string
          status?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "browser_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_actions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "browser_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_approvals: {
        Row: {
          action_id: string
          created_at: string
          id: string
          reason: string | null
          resolved_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          action_id: string
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          action_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_approvals_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: true
            referencedRelation: "browser_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_artifacts: {
        Row: {
          artifact_type: string
          created_at: string
          file_url: string | null
          id: string
          metadata: Json
          session_id: string
          task_id: string | null
          user_id: string
        }
        Insert: {
          artifact_type: string
          created_at?: string
          file_url?: string | null
          id?: string
          metadata?: Json
          session_id: string
          task_id?: string | null
          user_id: string
        }
        Update: {
          artifact_type?: string
          created_at?: string
          file_url?: string | null
          id?: string
          metadata?: Json
          session_id?: string
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_artifacts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "browser_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_artifacts_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "browser_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_sessions: {
        Row: {
          browser_profile_path: string | null
          created_at: string
          id: string
          last_worker_endpoint: string | null
          metadata: Json
          playwright_url: string | null
          status: string
          stopped_at: string | null
          updated_at: string
          user_id: string
          vnc_url: string | null
        }
        Insert: {
          browser_profile_path?: string | null
          created_at?: string
          id?: string
          last_worker_endpoint?: string | null
          metadata?: Json
          playwright_url?: string | null
          status?: string
          stopped_at?: string | null
          updated_at?: string
          user_id: string
          vnc_url?: string | null
        }
        Update: {
          browser_profile_path?: string | null
          created_at?: string
          id?: string
          last_worker_endpoint?: string | null
          metadata?: Json
          playwright_url?: string | null
          status?: string
          stopped_at?: string | null
          updated_at?: string
          user_id?: string
          vnc_url?: string | null
        }
        Relationships: []
      }
      browser_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string
          id: string
          result: Json | null
          session_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description: string
          id?: string
          result?: Json | null
          session_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string
          id?: string
          result?: Json | null
          session_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_tasks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "browser_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_ad_accounts: {
        Row: {
          ad_account_id: string
          ad_account_name: string | null
          created_at: string
          currency: string | null
          id: string
          last_synced_at: string | null
          meta_account_id: string
          status: string
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id: string
          ad_account_name?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          last_synced_at?: string | null
          meta_account_id: string
          status?: string
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string
          ad_account_name?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          last_synced_at?: string | null
          meta_account_id?: string
          status?: string
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connected_ad_accounts_meta_account_id_fkey"
            columns: ["meta_account_id"]
            isOneToOne: false
            referencedRelation: "connected_meta_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_meta_accounts: {
        Row: {
          access_token_encrypted: string
          created_at: string
          id: string
          last_synced_at: string | null
          meta_user_id: string
          meta_user_name: string | null
          scopes: string[] | null
          status: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          meta_user_id: string
          meta_user_name?: string | null
          scopes?: string[] | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          meta_user_id?: string
          meta_user_name?: string | null
          scopes?: string[] | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          metadata: Json
          role: string
          tool_call_id: string | null
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json
          role: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads: {
        Row: {
          ad_account_id: string
          adset_id: string
          created_at: string
          creative_format: string | null
          cta_type: string | null
          description: string | null
          destination_url: string | null
          effective_status: string | null
          headline: string | null
          id: string
          media_url: string | null
          meta_ad_id: string
          name: string
          primary_text: string | null
          raw_data: Json | null
          status: string
          synced_at: string | null
          tracking_specs: Json | null
          updated_at: string
          user_id: string
          utm_parameters: Json | null
        }
        Insert: {
          ad_account_id: string
          adset_id: string
          created_at?: string
          creative_format?: string | null
          cta_type?: string | null
          description?: string | null
          destination_url?: string | null
          effective_status?: string | null
          headline?: string | null
          id?: string
          media_url?: string | null
          meta_ad_id: string
          name: string
          primary_text?: string | null
          raw_data?: Json | null
          status?: string
          synced_at?: string | null
          tracking_specs?: Json | null
          updated_at?: string
          user_id: string
          utm_parameters?: Json | null
        }
        Update: {
          ad_account_id?: string
          adset_id?: string
          created_at?: string
          creative_format?: string | null
          cta_type?: string | null
          description?: string | null
          destination_url?: string | null
          effective_status?: string | null
          headline?: string | null
          id?: string
          media_url?: string | null
          meta_ad_id?: string
          name?: string
          primary_text?: string | null
          raw_data?: Json | null
          status?: string
          synced_at?: string | null
          tracking_specs?: Json | null
          updated_at?: string
          user_id?: string
          utm_parameters?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ads_adset_id_fkey"
            columns: ["adset_id"]
            isOneToOne: false
            referencedRelation: "meta_adsets"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_adsets: {
        Row: {
          ad_account_id: string
          attribution_setting: Json | null
          bid_strategy: string | null
          campaign_id: string
          created_at: string
          daily_budget: number | null
          effective_status: string | null
          end_time: string | null
          id: string
          lifetime_budget: number | null
          meta_adset_id: string
          name: string
          optimization_goal: string | null
          placements: Json | null
          raw_data: Json | null
          start_time: string | null
          status: string
          synced_at: string | null
          targeting: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id: string
          attribution_setting?: Json | null
          bid_strategy?: string | null
          campaign_id: string
          created_at?: string
          daily_budget?: number | null
          effective_status?: string | null
          end_time?: string | null
          id?: string
          lifetime_budget?: number | null
          meta_adset_id: string
          name: string
          optimization_goal?: string | null
          placements?: Json | null
          raw_data?: Json | null
          start_time?: string | null
          status?: string
          synced_at?: string | null
          targeting?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string
          attribution_setting?: Json | null
          bid_strategy?: string | null
          campaign_id?: string
          created_at?: string
          daily_budget?: number | null
          effective_status?: string | null
          end_time?: string | null
          id?: string
          lifetime_budget?: number | null
          meta_adset_id?: string
          name?: string
          optimization_goal?: string | null
          placements?: Json | null
          raw_data?: Json | null
          start_time?: string | null
          status?: string
          synced_at?: string | null
          targeting?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_adsets_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_adsets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "meta_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_api_error_logs: {
        Row: {
          ad_account_id: string | null
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          method: string | null
          request_body: Json | null
          response_body: Json | null
          status_code: number | null
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          method?: string | null
          request_body?: Json | null
          response_body?: Json | null
          status_code?: number | null
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          method?: string | null
          request_body?: Json | null
          response_body?: Json | null
          status_code?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_api_error_logs_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_automation_alerts: {
        Row: {
          ad_account_id: string | null
          ad_id: string | null
          adset_id: string | null
          campaign_id: string | null
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          metric_value: number | null
          rule_id: string
          severity: string
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          metric_value?: number | null
          rule_id: string
          severity?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          metric_value?: number | null
          rule_id?: string
          severity?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_automation_alerts_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_automation_alerts_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "meta_ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_automation_alerts_adset_id_fkey"
            columns: ["adset_id"]
            isOneToOne: false
            referencedRelation: "meta_adsets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_automation_alerts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "meta_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_automation_alerts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "meta_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_automation_rules: {
        Row: {
          action_config: Json | null
          action_type: string
          ad_account_id: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          metric: string
          name: string
          operator: string
          threshold: number
          updated_at: string
          user_id: string
        }
        Insert: {
          action_config?: Json | null
          action_type?: string
          ad_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          metric: string
          name: string
          operator: string
          threshold: number
          updated_at?: string
          user_id: string
        }
        Update: {
          action_config?: Json | null
          action_type?: string
          ad_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          metric?: string
          name?: string
          operator?: string
          threshold?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_automation_rules_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_campaigns: {
        Row: {
          ad_account_id: string
          buying_type: string | null
          created_at: string
          daily_budget: number | null
          effective_status: string | null
          id: string
          lifetime_budget: number | null
          meta_campaign_id: string
          meta_created_time: string | null
          meta_updated_time: string | null
          name: string
          objective: string | null
          raw_data: Json | null
          special_ad_categories: string[] | null
          start_time: string | null
          status: string
          stop_time: string | null
          synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id: string
          buying_type?: string | null
          created_at?: string
          daily_budget?: number | null
          effective_status?: string | null
          id?: string
          lifetime_budget?: number | null
          meta_campaign_id: string
          meta_created_time?: string | null
          meta_updated_time?: string | null
          name: string
          objective?: string | null
          raw_data?: Json | null
          special_ad_categories?: string[] | null
          start_time?: string | null
          status?: string
          stop_time?: string | null
          synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string
          buying_type?: string | null
          created_at?: string
          daily_budget?: number | null
          effective_status?: string | null
          id?: string
          lifetime_budget?: number | null
          meta_campaign_id?: string
          meta_created_time?: string | null
          meta_updated_time?: string | null
          name?: string
          objective?: string | null
          raw_data?: Json | null
          special_ad_categories?: string[] | null
          start_time?: string | null
          status?: string
          stop_time?: string | null
          synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaigns_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_sync_logs: {
        Row: {
          ad_account_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          records_synced: number | null
          started_at: string | null
          status: string
          sync_type: string
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          records_synced?: number | null
          started_at?: string | null
          status?: string
          sync_type: string
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          records_synced?: number | null
          started_at?: string | null
          status?: string
          sync_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_sync_logs_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "connected_ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          browser_profile_path: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          browser_profile_path?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          browser_profile_path?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tool_approvals: {
        Row: {
          approver_id: string | null
          created_at: string
          id: string
          reason: string | null
          resolved_at: string | null
          status: string
          tool_run_id: string
        }
        Insert: {
          approver_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          tool_run_id: string
        }
        Update: {
          approver_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          tool_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_approvals_tool_run_id_fkey"
            columns: ["tool_run_id"]
            isOneToOne: true
            referencedRelation: "tool_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_endpoints: {
        Row: {
          created_at: string
          endpoint_url: string
          headers: Json
          http_method: string
          id: string
          max_retries: number
          timeout_ms: number
          tool_id: string
        }
        Insert: {
          created_at?: string
          endpoint_url: string
          headers?: Json
          http_method?: string
          id?: string
          max_retries?: number
          timeout_ms?: number
          tool_id: string
        }
        Update: {
          created_at?: string
          endpoint_url?: string
          headers?: Json
          http_method?: string
          id?: string
          max_retries?: number
          timeout_ms?: number
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_endpoints_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_runs: {
        Row: {
          completed_at: string | null
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          input: Json
          message_id: string | null
          output: Json | null
          started_at: string | null
          status: string
          tool_call_id: string
          tool_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          message_id?: string | null
          output?: Json | null
          started_at?: string | null
          status?: string
          tool_call_id: string
          tool_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          message_id?: string | null
          output?: Json | null
          started_at?: string | null
          status?: string
          tool_call_id?: string
          tool_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_runs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_runs_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          created_at: string
          description: string
          id: string
          input_schema: Json
          is_active: boolean
          name: string
          requires_approval: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          input_schema?: Json
          is_active?: boolean
          name: string
          requires_approval?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          input_schema?: Json
          is_active?: boolean
          name?: string
          requires_approval?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff_or_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
    },
  },
} as const
