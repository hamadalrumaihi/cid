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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          audience: string
          author_id: string | null
          author_name: string | null
          body: string
          created_at: string
          id: string
          links: Json
          mentions: Json
          pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          author_id?: string | null
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          links?: Json
          mentions?: Json
          pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          author_id?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          links?: Json
          mentions?: Json
          pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_secrets: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity: string
          entity_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity?: string
          entity_id?: string | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ballistic_footprints: {
        Row: {
          case_id: string | null
          created_at: string
          gang_id: string | null
          id: string
          signature: string
          updated_at: string
          weapon: string | null
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          gang_id?: string | null
          id?: string
          signature: string
          updated_at?: string
          weapon?: string | null
        }
        Update: {
          case_id?: string | null
          created_at?: string
          gang_id?: string | null
          id?: string
          signature?: string
          updated_at?: string
          weapon?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ballistic_footprints_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ballistic_footprints_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
        ]
      }
      ballistics_benches: {
        Row: {
          bench_type: Database["public"]["Enums"]["bench_type"]
          case_id: string | null
          components: string[] | null
          created_at: string
          heat: string | null
          id: string
          name: string
          outputs: string[] | null
          tier: string | null
          updated_at: string
        }
        Insert: {
          bench_type: Database["public"]["Enums"]["bench_type"]
          case_id?: string | null
          components?: string[] | null
          created_at?: string
          heat?: string | null
          id?: string
          name: string
          outputs?: string[] | null
          tier?: string | null
          updated_at?: string
        }
        Update: {
          bench_type?: Database["public"]["Enums"]["bench_type"]
          case_id?: string | null
          components?: string[] | null
          created_at?: string
          heat?: string | null
          id?: string
          name?: string
          outputs?: string[] | null
          tier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ballistics_benches_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_access_grants: {
        Row: {
          case_id: string
          created_at: string
          granted_by: string | null
          id: string
          officer_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          officer_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          officer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_access_grants_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_access_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_access_grants_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_access_requests: {
        Row: {
          case_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          reason: string | null
          requester_id: string
          requester_name: string | null
          status: string
        }
        Insert: {
          case_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          reason?: string | null
          requester_id?: string
          requester_name?: string | null
          status?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          reason?: string | null
          requester_id?: string
          requester_name?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_access_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_access_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_access_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_assignments: {
        Row: {
          added_by: string | null
          assignment_source: string
          case_id: string
          created_at: string
          expires_at: string | null
          id: string
          joint_role: string | null
          officer_id: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          role: Database["public"]["Enums"]["assign_role"]
          temporary: boolean
        }
        Insert: {
          added_by?: string | null
          assignment_source?: string
          case_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          joint_role?: string | null
          officer_id: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          role?: Database["public"]["Enums"]["assign_role"]
          temporary?: boolean
        }
        Update: {
          added_by?: string | null
          assignment_source?: string
          case_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          joint_role?: string | null
          officer_id?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          role?: Database["public"]["Enums"]["assign_role"]
          temporary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "case_assignments_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_assignments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_assignments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_assignments_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_blockers: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          id: string
          legal_request_id: string | null
          owner_id: string | null
          report_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_at: string | null
          status: string
          task_id: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          legal_request_id?: string | null
          owner_id?: string | null
          report_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_at?: string | null
          status?: string
          task_id?: string | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          legal_request_id?: string | null
          owner_id?: string | null
          report_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_at?: string | null
          status?: string
          task_id?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_blockers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_blockers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_blockers_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_blockers_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_blockers_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_blockers_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_blockers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "case_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      case_files: {
        Row: {
          added_by: string | null
          case_number: string
          created_at: string
          drive_file_id: string
          icon_url: string | null
          id: string
          mime_type: string | null
          name: string
          web_view_link: string
        }
        Insert: {
          added_by?: string | null
          case_number: string
          created_at?: string
          drive_file_id: string
          icon_url?: string | null
          id?: string
          mime_type?: string | null
          name: string
          web_view_link: string
        }
        Update: {
          added_by?: string | null
          case_number?: string
          created_at?: string
          drive_file_id?: string
          icon_url?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          web_view_link?: string
        }
        Relationships: []
      }
      case_intel_links: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          ref_id: string
          role: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          ref_id: string
          role?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          ref_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_intel_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_intel_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_messages: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          case_id: string
          created_at: string
          id: string
          links: Json
          mentions: Json
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body: string
          case_id: string
          created_at?: string
          id?: string
          links?: Json
          mentions?: Json
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          links?: Json
          mentions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "case_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_signoff_history: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          case_id: string
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          source: string | null
          stage: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          case_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          source?: string | null
          stage?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          case_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          source?: string | null
          stage?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_signoff_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_signoff_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_tasks: {
        Row: {
          assignee: string | null
          case_id: string
          created_at: string
          created_by: string | null
          done: boolean
          due: string | null
          id: string
          parent_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          case_id: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          due?: string | null
          id?: string
          parent_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          case_id?: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          due?: string | null
          id?: string
          parent_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_tasks_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "case_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      case_templates: {
        Row: {
          active: boolean
          area: string | null
          bureau: Database["public"]["Enums"]["bureau"] | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          tasks: Json
          followup_days: number | null
          title: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          area?: string | null
          bureau?: Database["public"]["Enums"]["bureau"] | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          tasks?: Json
          followup_days?: number | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          area?: string | null
          bureau?: Database["public"]["Enums"]["bureau"] | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          tasks?: Json
          followup_days?: number | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          area: string | null
          archived_at: string | null
          archived_by: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          case_number: string
          charges: Json
          closed_at: string | null
          created_at: string
          created_by: string | null
          follow_up_at: string | null
          id: string
          is_joint_case: boolean
          joint_case_created_at: string | null
          joint_case_created_by: string | null
          joint_case_ended_at: string | null
          joint_case_ended_by: string | null
          last_stale_notified_at: string | null
          lead_detective_id: string | null
          notes: string | null
          operation_id: string | null
          originating_bureau: Database["public"]["Enums"]["bureau"] | null
          priority: string | null
          signoff_assignee_id: string | null
          signoff_stage: string | null
          signoff_status: string
          signoff_submitted_at: string | null
          signoff_submitted_by: string | null
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          archived_at?: string | null
          archived_by?: string | null
          bureau?: Database["public"]["Enums"]["bureau"]
          case_number: string
          charges?: Json
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_at?: string | null
          id?: string
          is_joint_case?: boolean
          joint_case_created_at?: string | null
          joint_case_created_by?: string | null
          joint_case_ended_at?: string | null
          joint_case_ended_by?: string | null
          last_stale_notified_at?: string | null
          lead_detective_id?: string | null
          notes?: string | null
          operation_id?: string | null
          originating_bureau?: Database["public"]["Enums"]["bureau"] | null
          priority?: string | null
          signoff_assignee_id?: string | null
          signoff_stage?: string | null
          signoff_status?: string
          signoff_submitted_at?: string | null
          signoff_submitted_by?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          archived_at?: string | null
          archived_by?: string | null
          bureau?: Database["public"]["Enums"]["bureau"]
          case_number?: string
          charges?: Json
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_at?: string | null
          id?: string
          is_joint_case?: boolean
          joint_case_created_at?: string | null
          joint_case_created_by?: string | null
          joint_case_ended_at?: string | null
          joint_case_ended_by?: string | null
          last_stale_notified_at?: string | null
          lead_detective_id?: string | null
          notes?: string | null
          operation_id?: string | null
          originating_bureau?: Database["public"]["Enums"]["bureau"] | null
          priority?: string | null
          signoff_assignee_id?: string | null
          signoff_stage?: string | null
          signoff_status?: string
          signoff_submitted_at?: string | null
          signoff_submitted_by?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_joint_case_created_by_fkey"
            columns: ["joint_case_created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_joint_case_ended_by_fkey"
            columns: ["joint_case_ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_lead_detective_id_fkey"
            columns: ["lead_detective_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_signoff_assignee_id_fkey"
            columns: ["signoff_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_signoff_submitted_by_fkey"
            columns: ["signoff_submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cid_records: {
        Row: {
          bureau: string | null
          callsign: string | null
          case_number: string | null
          charges: string | null
          created_at: string
          created_by: string | null
          gang: string | null
          id: string
          last_seen: string | null
          mugshot_url: string | null
          name: string
          notes: string | null
          officer: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bureau?: string | null
          callsign?: string | null
          case_number?: string | null
          charges?: string | null
          created_at?: string
          created_by?: string | null
          gang?: string | null
          id?: string
          last_seen?: string | null
          mugshot_url?: string | null
          name: string
          notes?: string | null
          officer?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bureau?: string | null
          callsign?: string | null
          case_number?: string | null
          charges?: string | null
          created_at?: string
          created_by?: string | null
          gang?: string | null
          id?: string
          last_seen?: string | null
          mugshot_url?: string | null
          name?: string
          notes?: string | null
          officer?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_errors: {
        Row: {
          created_at: string
          id: string
          message: string
          reporter_id: string | null
          route: string | null
          stack: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          reporter_id?: string | null
          route?: string | null
          stack?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          reporter_id?: string | null
          route?: string | null
          stack?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_errors_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commendations: {
        Row: {
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          note: string | null
          recipient_id: string | null
          recipient_name: string | null
          tint: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          note?: string | null
          recipient_id?: string | null
          recipient_name?: string | null
          tint?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          note?: string | null
          recipient_id?: string | null
          recipient_name?: string | null
          tint?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commendations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commendations_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      custody_chain: {
        Row: {
          at: string
          evidence_id: string
          from_officer: string | null
          id: string
          reason: string | null
          to_officer: string | null
          transferred_by: string | null
        }
        Insert: {
          at?: string
          evidence_id: string
          from_officer?: string | null
          id?: string
          reason?: string | null
          to_officer?: string | null
          transferred_by?: string | null
        }
        Update: {
          at?: string
          evidence_id?: string
          from_officer?: string | null
          id?: string
          reason?: string | null
          to_officer?: string | null
          transferred_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custody_chain_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custody_chain_transferred_by_fkey"
            columns: ["transferred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_member_ledger: {
        Row: {
          armed_at: string | null
          badge_number: string | null
          deleted_by: string | null
          display_name: string
          division: string | null
          email: string | null
          executed_at: string
          id: string
          reason: string
          references: Json
          role: string | null
          target_id: string
        }
        Insert: {
          armed_at?: string | null
          badge_number?: string | null
          deleted_by?: string | null
          display_name: string
          division?: string | null
          email?: string | null
          executed_at?: string
          id?: string
          reason: string
          references?: Json
          role?: string | null
          target_id: string
        }
        Update: {
          armed_at?: string | null
          badge_number?: string | null
          deleted_by?: string | null
          display_name?: string
          division?: string | null
          email?: string | null
          executed_at?: string
          id?: string
          reason?: string
          references?: Json
          role?: string | null
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deleted_member_ledger_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_tokens: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          target_id: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          target_id: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          target_id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      document_acknowledgements: {
        Row: {
          acknowledged_at: string
          document_id: string
          document_version_id: string
          id: string
          method: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          document_id: string
          document_version_id: string
          id?: string
          method?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          document_id?: string
          document_version_id?: string
          id?: string
          method?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_acknowledgements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_acknowledgements_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "documents_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_acknowledgements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_reading_campaigns: {
        Row: {
          audience: string
          created_at: string
          created_by: string
          deadline: string | null
          document_id: string
          document_version_id: string
          effective_at: string
          id: string
          reason: string
          status: string
          targets: Json
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          created_by?: string
          deadline?: string | null
          document_id: string
          document_version_id: string
          effective_at?: string
          id?: string
          reason: string
          status?: string
          targets?: Json
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          created_by?: string
          deadline?: string | null
          document_id?: string
          document_version_id?: string
          effective_at?: string
          id?: string
          reason?: string
          status?: string
          targets?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_reading_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_reading_campaigns_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_reading_campaigns_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "documents_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_relations: {
        Row: {
          created_at: string
          created_by: string
          document_id: string
          id: string
          label: string | null
          relation: string
          target_document_id: string | null
          target_id: string | null
          target_kind: string
          target_route: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string
          document_id: string
          id?: string
          label?: string | null
          relation: string
          target_document_id?: string | null
          target_id?: string | null
          target_kind: string
          target_route?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          document_id?: string
          id?: string
          label?: string | null
          relation?: string
          target_document_id?: string | null
          target_id?: string | null
          target_kind?: string
          target_route?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_relations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_relations_target_document_id_fkey"
            columns: ["target_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_suggestion_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          suggestion_id: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          id?: string
          suggestion_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_suggestion_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestion_comments_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "document_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_suggestion_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          note: string | null
          suggestion_id: string
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          note?: string | null
          suggestion_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          note?: string | null
          suggestion_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_suggestion_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestion_events_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "document_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_suggestions: {
        Row: {
          assigned_editor: string | null
          created_at: string
          created_by: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          document_version_number: number | null
          duplicate_of: string | null
          explanation: string
          id: string
          implemented_at: string | null
          implemented_version_id: string | null
          proposed_text: string | null
          related_case_id: string | null
          section_id: string | null
          section_title: string | null
          source_url: string | null
          status: string
          suggestion_type: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_editor?: string | null
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_id?: string | null
          document_version_number?: number | null
          duplicate_of?: string | null
          explanation: string
          id?: string
          implemented_at?: string | null
          implemented_version_id?: string | null
          proposed_text?: string | null
          related_case_id?: string | null
          section_id?: string | null
          section_title?: string | null
          source_url?: string | null
          status?: string
          suggestion_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_editor?: string | null
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_id?: string | null
          document_version_number?: number | null
          duplicate_of?: string | null
          explanation?: string
          id?: string
          implemented_at?: string | null
          implemented_version_id?: string | null
          proposed_text?: string | null
          related_case_id?: string | null
          section_id?: string | null
          section_title?: string | null
          source_url?: string | null
          status?: string
          suggestion_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_suggestions_assigned_editor_fkey"
            columns: ["assigned_editor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestions_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "document_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestions_implemented_version_id_fkey"
            columns: ["implemented_version_id"]
            isOneToOne: false
            referencedRelation: "documents_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_suggestions_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      document_user_state: {
        Row: {
          bookmarked: boolean
          document_id: string
          last_anchor: string | null
          last_viewed_at: string | null
          user_id: string
        }
        Insert: {
          bookmarked?: boolean
          document_id: string
          last_anchor?: string | null
          last_viewed_at?: string | null
          user_id: string
        }
        Update: {
          bookmarked?: boolean
          document_id?: string
          last_anchor?: string | null
          last_viewed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_user_state_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_user_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          acknowledgement_deadline: string | null
          acknowledgement_required: boolean
          approval_required: boolean
          approved_at: string | null
          approved_by: string | null
          bureau: string | null
          canonical_source: string
          case_id: string | null
          category: string | null
          classification: string
          content: Json | null
          content_hash: string | null
          created_at: string
          current_version_number: number
          document_type: string
          effective_at: string | null
          excerpt: string | null
          expires_at: string | null
          folder: string
          id: string
          kind: Database["public"]["Enums"]["doc_kind"]
          last_synced_at: string | null
          mandatory: boolean
          modified_label: string | null
          name: string
          owner_role: string | null
          owner_user_id: string | null
          review_due_at: string | null
          review_note: string | null
          review_outcome: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          search_tsv: unknown | null
          source_id: string | null
          source_modified_at: string | null
          source_system: string
          status: string
          sync_error: string | null
          sync_status: string | null
          tags: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acknowledgement_deadline?: string | null
          acknowledgement_required?: boolean
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          bureau?: string | null
          canonical_source?: string
          case_id?: string | null
          category?: string | null
          classification?: string
          content?: Json | null
          created_at?: string
          current_version_number?: number
          document_type?: string
          effective_at?: string | null
          expires_at?: string | null
          folder: string
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"]
          last_synced_at?: string | null
          mandatory?: boolean
          modified_label?: string | null
          name: string
          owner_role?: string | null
          owner_user_id?: string | null
          review_due_at?: string | null
          review_note?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_modified_at?: string | null
          source_system?: string
          status?: string
          sync_error?: string | null
          sync_status?: string | null
          tags?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acknowledgement_deadline?: string | null
          acknowledgement_required?: boolean
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          bureau?: string | null
          canonical_source?: string
          case_id?: string | null
          category?: string | null
          classification?: string
          content?: Json | null
          created_at?: string
          current_version_number?: number
          document_type?: string
          effective_at?: string | null
          expires_at?: string | null
          folder?: string
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"]
          last_synced_at?: string | null
          mandatory?: boolean
          modified_label?: string | null
          name?: string
          owner_role?: string | null
          owner_user_id?: string | null
          review_due_at?: string | null
          review_note?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_modified_at?: string | null
          source_system?: string
          status?: string
          sync_error?: string | null
          sync_status?: string | null
          tags?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents_versions: {
        Row: {
          change_summary: string | null
          change_type: string | null
          content: Json | null
          content_hash: string | null
          document_id: string
          effective_at: string | null
          id: string
          kind: Database["public"]["Enums"]["doc_kind"] | null
          metadata: Json | null
          modified_label: string | null
          name: string | null
          requires_reack: boolean
          restored_from: string | null
          saved_at: string
          saved_by: string | null
          source_revision: string | null
          source_system: string | null
          version_number: number | null
        }
        Insert: {
          change_summary?: string | null
          change_type?: string | null
          content?: Json | null
          document_id: string
          effective_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"] | null
          metadata?: Json | null
          modified_label?: string | null
          name?: string | null
          requires_reack?: boolean
          restored_from?: string | null
          saved_at?: string
          saved_by?: string | null
          source_revision?: string | null
          source_system?: string | null
          version_number?: number | null
        }
        Update: {
          change_summary?: string | null
          change_type?: string | null
          content?: Json | null
          document_id?: string
          effective_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"] | null
          metadata?: Json | null
          modified_label?: string | null
          name?: string | null
          requires_reack?: boolean
          restored_from?: string | null
          saved_at?: string
          saved_by?: string | null
          source_revision?: string | null
          source_system?: string | null
          version_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_versions_restored_from_fkey"
            columns: ["restored_from"]
            isOneToOne: false
            referencedRelation: "documents_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_versions_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence: {
        Row: {
          case_id: string | null
          collected_at: string | null
          collected_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          item_code: string | null
          location: string | null
          notes: string | null
          tamper: Database["public"]["Enums"]["evidence_tamper"]
          type: string | null
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          notes?: string | null
          tamper?: Database["public"]["Enums"]["evidence_tamper"]
          type?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          notes?: string | null
          tamper?: Database["public"]["Enums"]["evidence_tamper"]
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_collected_by_fkey"
            columns: ["collected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string
          created_by: string | null
          details: string | null
          id: string
          kind: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          kind?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          kind?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_meta: {
        Row: {
          archived_at: string | null
          category: string | null
          feedback_id: string
          internal_notes: string | null
          priority: string | null
          related_feature: string | null
          related_route: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          tags: Json
          type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          feedback_id: string
          internal_notes?: string | null
          priority?: string | null
          related_feature?: string | null
          related_route?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          tags?: Json
          type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          feedback_id?: string
          internal_notes?: string | null
          priority?: string | null
          related_feature?: string | null
          related_route?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          tags?: Json
          type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_meta_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: true
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_meta_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gang_members: {
        Row: {
          callsign: string | null
          case_id: string | null
          ccw: boolean | null
          confidence: string | null
          created_at: string
          created_by: string | null
          felony_count: number | null
          gang_id: string
          id: string
          joined_at: string | null
          left_at: string | null
          mugshot_url: string | null
          name: string | null
          note: string | null
          person_id: string | null
          provenance: string | null
          rank: string | null
          rank_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string
          vch: number | null
        }
        Insert: {
          callsign?: string | null
          case_id?: string | null
          ccw?: boolean | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          felony_count?: number | null
          gang_id: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          mugshot_url?: string | null
          name?: string | null
          note?: string | null
          person_id?: string | null
          provenance?: string | null
          rank?: string | null
          rank_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string
          vch?: number | null
        }
        Update: {
          callsign?: string | null
          case_id?: string | null
          ccw?: boolean | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          felony_count?: number | null
          gang_id?: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          mugshot_url?: string | null
          name?: string | null
          note?: string | null
          person_id?: string | null
          provenance?: string | null
          rank?: string | null
          rank_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string
          vch?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gang_members_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gang_members_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gang_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gang_members_rank_id_fkey"
            columns: ["rank_id"]
            isOneToOne: false
            referencedRelation: "gang_ranks"
            referencedColumns: ["id"]
          },
        ]
      }
      gang_places: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          gang_id: string
          id: string
          note: string | null
          place_id: string
          provenance: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          gang_id: string
          id?: string
          note?: string | null
          place_id: string
          provenance?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          gang_id?: string
          id?: string
          note?: string | null
          place_id?: string
          provenance?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gang_places_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gang_places_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gang_places_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gang_ranks: {
        Row: {
          gang_id: string
          id: string
          name: string
          sort_order: number | null
        }
        Insert: {
          gang_id: string
          id?: string
          name: string
          sort_order?: number | null
        }
        Update: {
          gang_id?: string
          id?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gang_ranks_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
        ]
      }
      gang_turf: {
        Row: {
          block: string
          confidence: string | null
          created_at: string
          density: Database["public"]["Enums"]["density"]
          first_observed: string | null
          gang_id: string
          hotspot_area: string | null
          id: string
          last_confirmed: string | null
          notes: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          block: string
          confidence?: string | null
          created_at?: string
          density?: Database["public"]["Enums"]["density"]
          first_observed?: string | null
          gang_id: string
          hotspot_area?: string | null
          id?: string
          last_confirmed?: string | null
          notes?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          block?: string
          confidence?: string | null
          created_at?: string
          density?: Database["public"]["Enums"]["density"]
          first_observed?: string | null
          gang_id?: string
          hotspot_area?: string | null
          id?: string
          last_confirmed?: string | null
          notes?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gang_turf_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
        ]
      }
      gangs: {
        Row: {
          aliases: string | null
          classification: string | null
          colors: string | null
          confidence: string | null
          created_at: string
          created_by: string | null
          id: string
          intelligence_summary: Json
          lead_detective_id: string | null
          name: string
          next_review_at: string | null
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          threat_level: Database["public"]["Enums"]["threat_level"]
          updated_at: string
        }
        Insert: {
          aliases?: string | null
          classification?: string | null
          colors?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          intelligence_summary?: Json
          lead_detective_id?: string | null
          name: string
          next_review_at?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          threat_level?: Database["public"]["Enums"]["threat_level"]
          updated_at?: string
        }
        Update: {
          aliases?: string | null
          classification?: string | null
          colors?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          intelligence_summary?: Json
          lead_detective_id?: string | null
          name?: string
          next_review_at?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          threat_level?: Database["public"]["Enums"]["threat_level"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gangs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gangs_lead_detective_id_fkey"
            columns: ["lead_detective_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gangs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      indicators: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          value: string
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          value: string
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "indicators_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicators_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      justice_membership_request_history: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: string
          internal: boolean
          note: string | null
          request_id: string
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          internal?: boolean
          note?: string | null
          request_id: string
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          internal?: boolean
          note?: string | null
          request_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "justice_membership_request_history_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "justice_membership_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "justice_membership_request_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      justice_membership_requests: {
        Row: {
          additional_notes: string | null
          applicant_id: string
          applicant_visible_decision_note: string | null
          created_at: string
          decided_agency: string | null
          decided_at: string | null
          decided_by: string | null
          decided_justice_role: string | null
          display_name: string
          id: string
          internal_decision_note: string | null
          justice_identifier: string | null
          reason: string
          requested_agency: string
          requested_justice_role: string
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          additional_notes?: string | null
          applicant_id: string
          applicant_visible_decision_note?: string | null
          created_at?: string
          decided_agency?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_justice_role?: string | null
          display_name: string
          id?: string
          internal_decision_note?: string | null
          justice_identifier?: string | null
          reason: string
          requested_agency: string
          requested_justice_role: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          additional_notes?: string | null
          applicant_id?: string
          applicant_visible_decision_note?: string | null
          created_at?: string
          decided_agency?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_justice_role?: string | null
          display_name?: string
          id?: string
          internal_decision_note?: string | null
          justice_identifier?: string | null
          reason?: string
          requested_agency?: string
          requested_justice_role?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "justice_membership_requests_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "justice_membership_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      justice_memberships: {
        Row: {
          active: boolean
          agency: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          justice_identifier: string | null
          justice_role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          agency: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          justice_identifier?: string | null
          justice_role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          agency?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          justice_identifier?: string | null
          justice_role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "justice_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "justice_memberships_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_holds: {
        Row: {
          case_id: string | null
          id: string
          legal_request_id: string | null
          lift_reason: string | null
          lifted_at: string | null
          lifted_by: string | null
          placed_at: string
          placed_by: string | null
          reason: string
        }
        Insert: {
          case_id?: string | null
          id?: string
          legal_request_id?: string | null
          lift_reason?: string | null
          lifted_at?: string | null
          lifted_by?: string | null
          placed_at?: string
          placed_by?: string | null
          reason: string
        }
        Update: {
          case_id?: string | null
          id?: string
          legal_request_id?: string | null
          lift_reason?: string | null
          lifted_at?: string | null
          lifted_by?: string | null
          placed_at?: string
          placed_by?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_holds_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_holds_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_holds_placed_by_fkey"
            columns: ["placed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_holds_lifted_by_fkey"
            columns: ["lifted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_request_actions: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          from_status: string | null
          id: string
          internal_note: string | null
          legal_request_id: string
          public_note: string | null
          to_status: string | null
          version_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          internal_note?: string | null
          legal_request_id: string
          public_note?: string | null
          to_status?: string | null
          version_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          internal_note?: string | null
          legal_request_id?: string
          public_note?: string | null
          to_status?: string | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_request_actions_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_actions_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "legal_request_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_actions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_request_exhibits: {
        Row: {
          added_by: string
          created_at: string
          display_title: string
          exhibit_type: string
          id: string
          legal_request_id: string
          rationale: string | null
          snapshot_metadata: Json
          source_id: string | null
          version_id: string | null
        }
        Insert: {
          added_by: string
          created_at?: string
          display_title: string
          exhibit_type: string
          id?: string
          legal_request_id: string
          rationale?: string | null
          snapshot_metadata?: Json
          source_id?: string | null
          version_id?: string | null
        }
        Update: {
          added_by?: string
          created_at?: string
          display_title?: string
          exhibit_type?: string
          id?: string
          legal_request_id?: string
          rationale?: string | null
          snapshot_metadata?: Json
          source_id?: string | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_request_exhibits_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_exhibits_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "legal_request_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_exhibits_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_request_participants: {
        Row: {
          added_at: string
          added_by: string
          legal_request_id: string
          participant_role: string
          removed_at: string | null
          removed_by: string | null
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          legal_request_id: string
          participant_role: string
          removed_at?: string | null
          removed_by?: string | null
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          legal_request_id?: string
          participant_role?: string
          removed_at?: string | null
          removed_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_request_participants_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_participants_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_request_signatures: {
        Row: {
          action: string
          id: string
          legal_request_id: string
          signature: string
          signed_at: string
          signer_id: string
          signer_name_snapshot: string
          signer_role_snapshot: string
          version_id: string
        }
        Insert: {
          action: string
          id?: string
          legal_request_id: string
          signature: string
          signed_at?: string
          signer_id: string
          signer_name_snapshot: string
          signer_role_snapshot: string
          version_id: string
        }
        Update: {
          action?: string
          id?: string
          legal_request_id?: string
          signature?: string
          signed_at?: string
          signer_id?: string
          signer_name_snapshot?: string
          signer_role_snapshot?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_request_signatures_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_signatures_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "legal_request_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_signatures_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_request_versions: {
        Row: {
          change_summary: string | null
          content_hash: string | null
          created_at: string
          created_by: string
          form_data: Json
          id: string
          legal_request_id: string
          narrative: string | null
          packet_manifest: Json
          returned_from: string | null
          submitted_stage: string | null
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          content_hash?: string | null
          created_at?: string
          created_by: string
          form_data: Json
          id?: string
          legal_request_id: string
          narrative?: string | null
          packet_manifest?: Json
          returned_from?: string | null
          submitted_stage?: string | null
          version_number: number
        }
        Update: {
          change_summary?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string
          form_data?: Json
          id?: string
          legal_request_id?: string
          narrative?: string | null
          packet_manifest?: Json
          returned_from?: string | null
          submitted_stage?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "legal_request_versions_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_request_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_requests: {
        Row: {
          approval_route: string | null
          assigned_ada_id: string | null
          assigned_judge_id: string | null
          case_id: string
          case_number_snapshot: string | null
          case_title_snapshot: string | null
          cid_reviewed_at: string | null
          cid_reviewed_by: string | null
          citizen_id_snapshot: string | null
          classification: string
          close_note: string | null
          closed_at: string | null
          closed_by: string | null
          compliance_date: string | null
          compliance_notes: string | null
          compliance_status: string
          created_at: string
          created_by: string
          current_version_id: string | null
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_note: string | null
          document_status: string
          executed_at: string | null
          executed_by: string | null
          execution_notes: string | null
          execution_outcome: string | null
          execution_result: string | null
          expires_at: string | null
          form_data: Json
          fulfilment_status: string
          id: string
          issued_at: string | null
          issued_by: string | null
          judicial_conditions: string | null
          narrative: string | null
          non_compliance_reason: string | null
          person_id: string | null
          person_name_snapshot: string | null
          priority: string | null
          recipient_acknowledged: boolean | null
          recipient_name: string | null
          recipient_type: string | null
          request_number: string
          request_type: string
          response_deadline: string | null
          responsible_bureau: Database["public"]["Enums"]["bureau"]
          return_filed_by: string | null
          return_narrative: string | null
          returned_at: string | null
          review_status: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          served_at: string | null
          served_by: string | null
          service_method: string | null
          service_notes: string | null
          service_status: string
          source_report_id: string | null
          source_report_seq: number | null
          submitted_to_cid_at: string | null
          submitted_to_doj_at: string | null
          submitted_to_judge_at: string | null
          subtype: string
          title: string
          updated_at: string
          source_system: string | null
          source_submitted_at: string | null
          source_submitter_id: string | null
          imported_by: string | null
          imported_at: string | null
          import_key: string | null
        }
        Insert: {
          approval_route?: string | null
          assigned_ada_id?: string | null
          assigned_judge_id?: string | null
          case_id: string
          case_number_snapshot?: string | null
          case_title_snapshot?: string | null
          cid_reviewed_at?: string | null
          cid_reviewed_by?: string | null
          citizen_id_snapshot?: string | null
          classification?: string
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          compliance_date?: string | null
          compliance_notes?: string | null
          compliance_status?: string
          created_at?: string
          created_by: string
          current_version_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_note?: string | null
          document_status?: string
          executed_at?: string | null
          executed_by?: string | null
          execution_notes?: string | null
          execution_outcome?: string | null
          execution_result?: string | null
          expires_at?: string | null
          form_data?: Json
          fulfilment_status?: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          judicial_conditions?: string | null
          narrative?: string | null
          non_compliance_reason?: string | null
          person_id?: string | null
          person_name_snapshot?: string | null
          priority?: string | null
          recipient_acknowledged?: boolean | null
          recipient_name?: string | null
          recipient_type?: string | null
          request_number?: string
          request_type: string
          response_deadline?: string | null
          responsible_bureau: Database["public"]["Enums"]["bureau"]
          return_filed_by?: string | null
          return_narrative?: string | null
          returned_at?: string | null
          review_status?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          served_at?: string | null
          served_by?: string | null
          service_method?: string | null
          service_notes?: string | null
          service_status?: string
          source_report_id?: string | null
          source_report_seq?: number | null
          submitted_to_cid_at?: string | null
          submitted_to_doj_at?: string | null
          submitted_to_judge_at?: string | null
          subtype: string
          title: string
          updated_at?: string
          source_system?: string | null
          source_submitted_at?: string | null
          source_submitter_id?: string | null
          imported_by?: string | null
          imported_at?: string | null
          import_key?: string | null
        }
        Update: {
          approval_route?: string | null
          assigned_ada_id?: string | null
          assigned_judge_id?: string | null
          case_id?: string
          case_number_snapshot?: string | null
          case_title_snapshot?: string | null
          cid_reviewed_at?: string | null
          cid_reviewed_by?: string | null
          citizen_id_snapshot?: string | null
          classification?: string
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          compliance_date?: string | null
          compliance_notes?: string | null
          compliance_status?: string
          created_at?: string
          created_by?: string
          current_version_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_note?: string | null
          document_status?: string
          executed_at?: string | null
          executed_by?: string | null
          execution_notes?: string | null
          execution_outcome?: string | null
          execution_result?: string | null
          expires_at?: string | null
          form_data?: Json
          fulfilment_status?: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          judicial_conditions?: string | null
          narrative?: string | null
          non_compliance_reason?: string | null
          person_id?: string | null
          person_name_snapshot?: string | null
          priority?: string | null
          recipient_acknowledged?: boolean | null
          recipient_name?: string | null
          recipient_type?: string | null
          request_number?: string
          request_type?: string
          response_deadline?: string | null
          responsible_bureau?: Database["public"]["Enums"]["bureau"]
          return_filed_by?: string | null
          return_narrative?: string | null
          returned_at?: string | null
          review_status?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          served_at?: string | null
          served_by?: string | null
          service_method?: string | null
          service_notes?: string | null
          service_status?: string
          source_report_id?: string | null
          source_report_seq?: number | null
          submitted_to_cid_at?: string | null
          submitted_to_doj_at?: string | null
          submitted_to_judge_at?: string | null
          subtype?: string
          title?: string
          updated_at?: string
          source_system?: string | null
          source_submitted_at?: string | null
          source_submitter_id?: string | null
          imported_by?: string | null
          imported_at?: string | null
          import_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_requests_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_requests_assigned_ada_id_fkey"
            columns: ["assigned_ada_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_requests_assigned_judge_id_fkey"
            columns: ["assigned_judge_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_requests_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_requests_current_version_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "legal_request_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_seized_items: {
        Row: {
          added_by: string | null
          category: string | null
          created_at: string
          evidence_id: string | null
          id: string
          item: string
          legal_request_id: string
          notes: string | null
          person_id: string | null
          quantity: string | null
          vehicle_id: string | null
        }
        Insert: {
          added_by?: string | null
          category?: string | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          item: string
          legal_request_id: string
          notes?: string | null
          person_id?: string | null
          quantity?: string | null
          vehicle_id?: string | null
        }
        Update: {
          added_by?: string | null
          category?: string | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          item?: string
          legal_request_id?: string
          notes?: string | null
          person_id?: string | null
          quantity?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_seized_items_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: false
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_seized_items_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_seized_items_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_seized_items_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_seized_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mdt_exports: {
        Row: {
          clear_reason: string | null
          cleared_at: string | null
          cleared_by: string | null
          exported_at: string | null
          exported_by: string | null
          id: string
          instructions: string | null
          kind: string
          person_id: string | null
          proposed_at: string
          proposed_by: string | null
          reason: string | null
          risk_level: string | null
          source_case_id: string | null
          status: string
          subject_snapshot: string
          sync_status: string
          updated_at: string
          vehicle_id: string | null
          wanted_status: string | null
        }
        Insert: {
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          exported_at?: string | null
          exported_by?: string | null
          id?: string
          instructions?: string | null
          kind: string
          person_id?: string | null
          proposed_at?: string
          proposed_by?: string | null
          reason?: string | null
          risk_level?: string | null
          source_case_id?: string | null
          status?: string
          subject_snapshot: string
          sync_status?: string
          updated_at?: string
          vehicle_id?: string | null
          wanted_status?: string | null
        }
        Update: {
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          exported_at?: string | null
          exported_by?: string | null
          id?: string
          instructions?: string | null
          kind?: string
          person_id?: string | null
          proposed_at?: string
          proposed_by?: string | null
          reason?: string | null
          risk_level?: string | null
          source_case_id?: string | null
          status?: string
          subject_snapshot?: string
          sync_status?: string
          updated_at?: string
          vehicle_id?: string | null
          wanted_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mdt_exports_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mdt_exports_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mdt_exports_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mdt_exports_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mdt_exports_exported_by_fkey"
            columns: ["exported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mdt_exports_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mdt_wanted_projections: {
        Row: {
          classification_safe_warning: string | null
          expires_at: string | null
          id: string
          issue_date: string | null
          issuing_judge_name: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          legal_request_id: string
          person_id: string | null
          person_name_snapshot: string | null
          sync_attempts: number
          sync_status: string
          updated_at: string
          wanted_status: string
          warrant_reference: string
          warrant_type: string
        }
        Insert: {
          classification_safe_warning?: string | null
          expires_at?: string | null
          id?: string
          issue_date?: string | null
          issuing_judge_name?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          legal_request_id: string
          person_id?: string | null
          person_name_snapshot?: string | null
          sync_attempts?: number
          sync_status?: string
          updated_at?: string
          wanted_status: string
          warrant_reference: string
          warrant_type: string
        }
        Update: {
          classification_safe_warning?: string | null
          expires_at?: string | null
          id?: string
          issue_date?: string | null
          issuing_judge_name?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          legal_request_id?: string
          person_id?: string | null
          person_name_snapshot?: string | null
          sync_attempts?: number
          sync_status?: string
          updated_at?: string
          wanted_status?: string
          warrant_reference?: string
          warrant_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "mdt_wanted_projections_legal_request_id_fkey"
            columns: ["legal_request_id"]
            isOneToOne: true
            referencedRelation: "legal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mdt_wanted_projections_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      prosecutor_bureau_assignments: {
        Row: {
          assigned_by: string
          assignment_note: string | null
          assignment_type: string
          bureau: Database["public"]["Enums"]["bureau"]
          created_at: string
          ends_at: string | null
          id: string
          prosecutor_id: string
          starts_at: string
        }
        Insert: {
          assigned_by: string
          assignment_note?: string | null
          assignment_type?: string
          bureau: Database["public"]["Enums"]["bureau"]
          created_at?: string
          ends_at?: string | null
          id?: string
          prosecutor_id: string
          starts_at?: string
        }
        Update: {
          assigned_by?: string
          assignment_note?: string | null
          assignment_type?: string
          bureau?: Database["public"]["Enums"]["bureau"]
          created_at?: string
          ends_at?: string | null
          id?: string
          prosecutor_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prosecutor_bureau_assignments_prosecutor_id_fkey"
            columns: ["prosecutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosecutor_bureau_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          archived_at: string | null
          case_id: string | null
          category: string | null
          created_at: string
          external_url: string | null
          featured: boolean
          gang_id: string | null
          id: string
          kind: string | null
          narcotic_id: string | null
          person_id: string | null
          place_id: string | null
          report_id: string | null
          restricted: boolean
          storage_path: string | null
          tags: Json | null
          title: string
          type: Database["public"]["Enums"]["media_type"]
          updated_at: string
          uploaded_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          archived_at?: string | null
          case_id?: string | null
          category?: string | null
          created_at?: string
          external_url?: string | null
          featured?: boolean
          gang_id?: string | null
          id?: string
          kind?: string | null
          narcotic_id?: string | null
          person_id?: string | null
          place_id?: string | null
          report_id?: string | null
          restricted?: boolean
          storage_path?: string | null
          tags?: Json | null
          title: string
          type: Database["public"]["Enums"]["media_type"]
          updated_at?: string
          uploaded_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          archived_at?: string | null
          case_id?: string | null
          category?: string | null
          created_at?: string
          external_url?: string | null
          featured?: boolean
          gang_id?: string | null
          id?: string
          kind?: string | null
          narcotic_id?: string | null
          person_id?: string | null
          place_id?: string | null
          report_id?: string | null
          restricted?: boolean
          storage_path?: string | null
          tags?: Json | null
          title?: string
          type?: Database["public"]["Enums"]["media_type"]
          updated_at?: string
          uploaded_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      mo_profiles: {
        Row: {
          case_id: string
          created_at: string
          id: string
          indicators: Json
          narrative: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          indicators?: Json
          narrative?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          indicators?: Json
          narrative?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mo_profiles_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_aliases: {
        Row: {
          alias: string
          alias_type: string
          created_at: string
          created_by: string | null
          id: string
          narcotic_id: string
          server_specific: boolean
          source_case_id: string | null
        }
        Insert: {
          alias: string
          alias_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          narcotic_id: string
          server_specific?: boolean
          source_case_id?: string | null
        }
        Update: {
          alias?: string
          alias_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          narcotic_id?: string
          server_specific?: boolean
          source_case_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_aliases_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_aliases_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_gangs: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          first_observed: string | null
          gang_id: string
          id: string
          last_confirmed: string | null
          link_status: string
          narcotic_id: string
          notes: string | null
          provenance: string | null
          role: string
          source_case_id: string | null
          source_evidence_id: string | null
          source_report_id: string | null
          updated_at: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          gang_id: string
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id: string
          notes?: string | null
          provenance?: string | null
          role: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          gang_id?: string
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id?: string
          notes?: string | null
          provenance?: string | null
          role?: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_gangs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_gangs_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_gangs_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_gangs_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_gangs_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_gangs_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_hotspots: {
        Row: {
          area: string
          case_id: string | null
          density: Database["public"]["Enums"]["density"]
          id: string
          narcotic_id: string
          place_id: string | null
        }
        Insert: {
          area: string
          case_id?: string | null
          density?: Database["public"]["Enums"]["density"]
          id?: string
          narcotic_id: string
          place_id?: string | null
        }
        Update: {
          area?: string
          case_id?: string | null
          density?: Database["public"]["Enums"]["density"]
          id?: string
          narcotic_id?: string
          place_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_hotspots_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_hotspots_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_hotspots_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_persons: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          first_observed: string | null
          id: string
          last_confirmed: string | null
          link_status: string
          narcotic_id: string
          notes: string | null
          person_id: string
          provenance: string | null
          role: string
          source_case_id: string | null
          source_evidence_id: string | null
          source_report_id: string | null
          updated_at: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id: string
          notes?: string | null
          person_id: string
          provenance?: string | null
          role: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id?: string
          notes?: string | null
          person_id?: string
          provenance?: string | null
          role?: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_persons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_persons_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_persons_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_persons_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_persons_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_persons_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_places: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          first_observed: string | null
          id: string
          last_confirmed: string | null
          link_status: string
          narcotic_id: string
          notes: string | null
          place_id: string
          provenance: string | null
          role: string
          source_case_id: string | null
          source_evidence_id: string | null
          source_report_id: string | null
          updated_at: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id: string
          notes?: string | null
          place_id: string
          provenance?: string | null
          role: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id?: string
          notes?: string | null
          place_id?: string
          provenance?: string | null
          role?: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_places_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_places_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_places_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_places_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_places_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_places_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_precursors: {
        Row: {
          default_purity: number | null
          id: string
          name: string
          narcotic_id: string
          sort_order: number | null
        }
        Insert: {
          default_purity?: number | null
          id?: string
          name: string
          narcotic_id: string
          sort_order?: number | null
        }
        Update: {
          default_purity?: number | null
          id?: string
          name?: string
          narcotic_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_precursors_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_sale_observations: {
        Row: {
          analyst_note: string | null
          buyer_ref: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          investigator_id: string | null
          location_ref: string | null
          methodology: string | null
          narcotic_id: string
          notes: string | null
          observation_number: number | null
          observed_at: string | null
          observed_date_precision: string
          payment_amount: number
          payment_type: string
          product_name: string | null
          product_state: string
          provenance: string | null
          quality_tier: string | null
          recorded_weight_text: string | null
          recorded_weight_unit: string | null
          recorded_weight_value: number | null
          restricted: boolean
          series_id: string
          source_case_id: string | null
          source_confidence: string | null
          source_evidence_id: string | null
          state: string
          total_units: number
          updated_at: string
          weight_is_derived: boolean
        }
        Insert: {
          analyst_note?: string | null
          buyer_ref?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          investigator_id?: string | null
          location_ref?: string | null
          methodology?: string | null
          narcotic_id: string
          notes?: string | null
          observation_number?: number | null
          observed_at?: string | null
          observed_date_precision?: string
          payment_amount?: number
          payment_type?: string
          product_name?: string | null
          product_state?: string
          provenance?: string | null
          quality_tier?: string | null
          recorded_weight_text?: string | null
          recorded_weight_unit?: string | null
          recorded_weight_value?: number | null
          restricted?: boolean
          series_id: string
          source_case_id?: string | null
          source_confidence?: string | null
          source_evidence_id?: string | null
          state?: string
          total_units?: number
          updated_at?: string
          weight_is_derived?: boolean
        }
        Update: {
          analyst_note?: string | null
          buyer_ref?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          investigator_id?: string | null
          location_ref?: string | null
          methodology?: string | null
          narcotic_id?: string
          notes?: string | null
          observation_number?: number | null
          observed_at?: string | null
          observed_date_precision?: string
          payment_amount?: number
          payment_type?: string
          product_name?: string | null
          product_state?: string
          provenance?: string | null
          quality_tier?: string | null
          recorded_weight_text?: string | null
          recorded_weight_unit?: string | null
          recorded_weight_value?: number | null
          restricted?: boolean
          series_id?: string
          source_case_id?: string | null
          source_confidence?: string | null
          source_evidence_id?: string | null
          state?: string
          total_units?: number
          updated_at?: string
          weight_is_derived?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_sale_observations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_observations_investigator_id_fkey"
            columns: ["investigator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_observations_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_observations_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "narcotic_sale_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_observations_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_observations_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_sale_series: {
        Row: {
          analyst_note: string | null
          collection_state: string
          confidence: string | null
          created_at: string
          created_by: string | null
          id: string
          investigator_id: string | null
          method: string | null
          name: string
          narcotic_id: string
          next_action: string | null
          notes: string | null
          payment_type: string
          product_name: string | null
          provenance: string | null
          purpose: string | null
          restricted: boolean
          status: string
          updated_at: string
        }
        Insert: {
          analyst_note?: string | null
          collection_state?: string
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          investigator_id?: string | null
          method?: string | null
          name: string
          narcotic_id: string
          next_action?: string | null
          notes?: string | null
          payment_type?: string
          product_name?: string | null
          provenance?: string | null
          purpose?: string | null
          restricted?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          analyst_note?: string | null
          collection_state?: string
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          investigator_id?: string | null
          method?: string | null
          name?: string
          narcotic_id?: string
          next_action?: string | null
          notes?: string | null
          payment_type?: string
          product_name?: string | null
          provenance?: string | null
          purpose?: string | null
          restricted?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_sale_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_series_investigator_id_fkey"
            columns: ["investigator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_series_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_sale_stacks: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          observation_id: string
          recorded_weight_text: string | null
          recorded_weight_unit: string | null
          recorded_weight_value: number | null
          stack_number: number
          units: number
          updated_at: string
          weight_is_derived: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          observation_id: string
          recorded_weight_text?: string | null
          recorded_weight_unit?: string | null
          recorded_weight_value?: number | null
          stack_number: number
          units?: number
          updated_at?: string
          weight_is_derived?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          observation_id?: string
          recorded_weight_text?: string | null
          recorded_weight_unit?: string | null
          recorded_weight_value?: number | null
          stack_number?: number
          units?: number
          updated_at?: string
          weight_is_derived?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_sale_stacks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_sale_stacks_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "narcotic_sale_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_seizures: {
        Row: {
          amount_recorded: string | null
          case_id: string | null
          created_at: string
          created_by: string | null
          evidence_id: string | null
          id: string
          location: string | null
          narcotic_id: string
          notes: string | null
          packaging: string | null
          seized_at: string | null
          state: string
          unit_recorded: string | null
          updated_at: string
        }
        Insert: {
          amount_recorded?: string | null
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          evidence_id?: string | null
          id?: string
          location?: string | null
          narcotic_id: string
          notes?: string | null
          packaging?: string | null
          seized_at?: string | null
          state?: string
          unit_recorded?: string | null
          updated_at?: string
        }
        Update: {
          amount_recorded?: string | null
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          evidence_id?: string | null
          id?: string
          location?: string | null
          narcotic_id?: string
          notes?: string | null
          packaging?: string | null
          seized_at?: string | null
          state?: string
          unit_recorded?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_seizures_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_seizures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_seizures_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_seizures_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_suggestion_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          note: string | null
          suggestion_id: string
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          note?: string | null
          suggestion_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          note?: string | null
          suggestion_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_suggestion_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_suggestion_events_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "narcotic_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_suggestions: {
        Row: {
          created_at: string
          created_by: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          explanation: string
          id: string
          narcotic_id: string | null
          proposed_value: string | null
          source_case_id: string | null
          source_evidence_id: string | null
          source_report_id: string | null
          status: string
          suggestion_type: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          explanation: string
          id?: string
          narcotic_id?: string | null
          proposed_value?: string | null
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          status?: string
          suggestion_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          explanation?: string
          id?: string
          narcotic_id?: string | null
          proposed_value?: string | null
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          status?: string
          suggestion_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_suggestions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_suggestions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_suggestions_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_suggestions_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_suggestions_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_suggestions_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotic_vehicles: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          first_observed: string | null
          id: string
          last_confirmed: string | null
          link_status: string
          narcotic_id: string
          notes: string | null
          provenance: string | null
          role: string
          source_case_id: string | null
          source_evidence_id: string | null
          source_report_id: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id: string
          notes?: string | null
          provenance?: string | null
          role: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          narcotic_id?: string
          notes?: string | null
          provenance?: string | null
          role?: string
          source_case_id?: string | null
          source_evidence_id?: string | null
          source_report_id?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "narcotic_vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_vehicles_narcotic_id_fkey"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_vehicles_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_vehicles_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_vehicles_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotic_vehicles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_request_history: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: string
          internal: boolean
          note: string | null
          request_id: string
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          internal?: boolean
          note?: string | null
          request_id: string
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          internal?: boolean
          note?: string | null
          request_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_request_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_request_history_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "membership_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_requests: {
        Row: {
          additional_notes: string | null
          applicant_id: string
          applicant_visible_decision_note: string | null
          badge_number: string | null
          created_at: string
          decided_at: string | null
          decided_bureau: Database["public"]["Enums"]["bureau"] | null
          decided_by: string | null
          decided_role: Database["public"]["Enums"]["app_role"] | null
          display_name: string
          id: string
          internal_decision_note: string | null
          reason: string
          requested_bureau: Database["public"]["Enums"]["bureau"]
          requested_role: Database["public"]["Enums"]["app_role"]
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          additional_notes?: string | null
          applicant_id: string
          applicant_visible_decision_note?: string | null
          badge_number?: string | null
          created_at?: string
          decided_at?: string | null
          decided_bureau?: Database["public"]["Enums"]["bureau"] | null
          decided_by?: string | null
          decided_role?: Database["public"]["Enums"]["app_role"] | null
          display_name: string
          id?: string
          internal_decision_note?: string | null
          reason: string
          requested_bureau: Database["public"]["Enums"]["bureau"]
          requested_role: Database["public"]["Enums"]["app_role"]
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          additional_notes?: string | null
          applicant_id?: string
          applicant_visible_decision_note?: string | null
          badge_number?: string | null
          created_at?: string
          decided_at?: string | null
          decided_bureau?: Database["public"]["Enums"]["bureau"] | null
          decided_by?: string | null
          decided_role?: Database["public"]["Enums"]["app_role"] | null
          display_name?: string
          id?: string
          internal_decision_note?: string | null
          reason?: string
          requested_bureau?: Database["public"]["Enums"]["bureau"]
          requested_role?: Database["public"]["Enums"]["app_role"]
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_requests_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      narcotics: {
        Row: {
          appearance: string | null
          category: string
          charge_codes: Json
          classification: string | null
          confidence: string | null
          created_at: string
          created_by: string | null
          first_recorded_at: string | null
          icon: string | null
          id: string
          in_city_significance: string | null
          intelligence_gaps: string | null
          last_confirmed_at: string | null
          merged_into: string | null
          name: string
          officer_safety: string | null
          packaging: string | null
          popularity: number | null
          provenance: string | null
          representative_media_id: string | null
          restricted: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          scene_indicators: string | null
          search_tsv: unknown | null
          server_specific: boolean
          source_case_id: string | null
          source_evidence_id: string | null
          status: string
          street_price: number | null
          summary: string | null
          updated_at: string
          wholesale_price: number | null
        }
        Insert: {
          appearance?: string | null
          category?: string
          charge_codes?: Json
          classification?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_recorded_at?: string | null
          icon?: string | null
          id?: string
          in_city_significance?: string | null
          intelligence_gaps?: string | null
          last_confirmed_at?: string | null
          merged_into?: string | null
          name: string
          officer_safety?: string | null
          packaging?: string | null
          popularity?: number | null
          provenance?: string | null
          representative_media_id?: string | null
          restricted?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          scene_indicators?: string | null
          server_specific?: boolean
          source_case_id?: string | null
          source_evidence_id?: string | null
          status?: string
          street_price?: number | null
          summary?: string | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Update: {
          appearance?: string | null
          category?: string
          charge_codes?: Json
          classification?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_recorded_at?: string | null
          icon?: string | null
          id?: string
          in_city_significance?: string | null
          intelligence_gaps?: string | null
          last_confirmed_at?: string | null
          merged_into?: string | null
          name?: string
          officer_safety?: string | null
          packaging?: string | null
          popularity?: number | null
          provenance?: string | null
          representative_media_id?: string | null
          restricted?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          scene_indicators?: string | null
          server_specific?: boolean
          source_case_id?: string | null
          source_evidence_id?: string | null
          status?: string
          street_price?: number | null
          summary?: string | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "narcotics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotics_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotics_representative_media_id_fkey"
            columns: ["representative_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotics_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotics_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narcotics_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json | null
          read: boolean
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json | null
          read?: boolean
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json | null
          read?: boolean
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      person_places: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          first_observed: string | null
          id: string
          last_confirmed: string | null
          link_status: string
          note: string | null
          person_id: string
          place_id: string
          provenance: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          note?: string | null
          person_id: string
          place_id: string
          provenance?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          note?: string | null
          person_id?: string
          place_id?: string
          provenance?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_places_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_places_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_places_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      person_relationships: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          first_observed: string | null
          id: string
          last_confirmed: string | null
          note: string | null
          person_a: string
          person_b: string
          provenance: string | null
          rel_status: string
          relationship: string
          updated_at: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          note?: string | null
          person_a: string
          person_b: string
          provenance?: string | null
          rel_status?: string
          relationship: string
          updated_at?: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          note?: string | null
          person_a?: string
          person_b?: string
          provenance?: string | null
          rel_status?: string
          relationship?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_relationships_person_a_fkey"
            columns: ["person_a"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_relationships_person_b_fkey"
            columns: ["person_b"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      person_vehicles: {
        Row: {
          confidence: string | null
          created_at: string
          created_by: string | null
          first_observed: string | null
          id: string
          last_confirmed: string | null
          link_status: string
          note: string | null
          person_id: string
          provenance: string | null
          role: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          note?: string | null
          person_id: string
          provenance?: string | null
          role: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          first_observed?: string | null
          id?: string
          last_confirmed?: string | null
          link_status?: string
          note?: string | null
          person_id?: string
          provenance?: string | null
          role?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_vehicles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_vehicles_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      persons: {
        Row: {
          alias: string | null
          bolo: boolean
          bolo_case_id: string | null
          bolo_expires_at: string | null
          bolo_instructions: string | null
          bolo_issued_at: string | null
          bolo_issued_by: string | null
          bolo_reason: string | null
          bolo_risk: string | null
          ccw: boolean | null
          classification: string | null
          confidence: string | null
          created_at: string
          created_by: string | null
          dob: string | null
          felony_count: number | null
          gang_id: string | null
          id: string
          identity: Json
          intelligence_summary: Json
          lead_detective_id: string | null
          lifecycle: string
          merged_into: string | null
          mugshot_url: string | null
          name: string
          next_review_at: string | null
          notes: string | null
          phone: string | null
          priority: string | null
          properties: Json
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string
          vch: number | null
        }
        Insert: {
          alias?: string | null
          bolo?: boolean
          bolo_case_id?: string | null
          bolo_expires_at?: string | null
          bolo_instructions?: string | null
          bolo_issued_at?: string | null
          bolo_issued_by?: string | null
          bolo_reason?: string | null
          bolo_risk?: string | null
          ccw?: boolean | null
          classification?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          felony_count?: number | null
          gang_id?: string | null
          id?: string
          identity?: Json
          intelligence_summary?: Json
          lead_detective_id?: string | null
          lifecycle?: string
          merged_into?: string | null
          mugshot_url?: string | null
          name: string
          next_review_at?: string | null
          notes?: string | null
          phone?: string | null
          priority?: string | null
          properties?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string
          vch?: number | null
        }
        Update: {
          alias?: string | null
          bolo?: boolean
          bolo_case_id?: string | null
          bolo_expires_at?: string | null
          bolo_instructions?: string | null
          bolo_issued_at?: string | null
          bolo_issued_by?: string | null
          bolo_reason?: string | null
          bolo_risk?: string | null
          ccw?: boolean | null
          classification?: string | null
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          felony_count?: number | null
          gang_id?: string | null
          id?: string
          identity?: Json
          intelligence_summary?: Json
          lead_detective_id?: string | null
          lifecycle?: string
          merged_into?: string | null
          mugshot_url?: string | null
          name?: string
          next_review_at?: string | null
          notes?: string | null
          phone?: string | null
          priority?: string | null
          properties?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string
          vch?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "persons_bolo_case_id_fkey"
            columns: ["bolo_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_bolo_issued_by_fkey"
            columns: ["bolo_issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_gang_fk"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_lead_detective_id_fkey"
            columns: ["lead_detective_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persons_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      place_process_steps: {
        Row: {
          description: string
          id: string
          place_id: string
          step_order: number | null
        }
        Insert: {
          description: string
          id?: string
          place_id: string
          step_order?: number | null
        }
        Update: {
          description?: string
          id?: string
          place_id?: string
          step_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "place_process_steps_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      places: {
        Row: {
          area: string | null
          case_id: string | null
          controlling_gang_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          narcotic_id: string | null
          notes: string | null
          type: Database["public"]["Enums"]["location_type"]
          updated_at: string
        }
        Insert: {
          area?: string | null
          case_id?: string | null
          controlling_gang_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          narcotic_id?: string | null
          notes?: string | null
          type: Database["public"]["Enums"]["location_type"]
          updated_at?: string
        }
        Update: {
          area?: string | null
          case_id?: string | null
          controlling_gang_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          narcotic_id?: string | null
          notes?: string | null
          type?: Database["public"]["Enums"]["location_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "places_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_controlling_gang_id_fkey"
            columns: ["controlling_gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_narcotic_fk"
            columns: ["narcotic_id"]
            isOneToOne: false
            referencedRelation: "narcotics"
            referencedColumns: ["id"]
          },
        ]
      }
      predicate_acts: {
        Row: {
          act_date: string | null
          created_at: string
          evidence_id: string | null
          evidence_ref: string | null
          id: string
          note: string | null
          predicate_type: string
          rico_case_id: string
          updated_at: string
        }
        Insert: {
          act_date?: string | null
          created_at?: string
          evidence_id?: string | null
          evidence_ref?: string | null
          id?: string
          note?: string | null
          predicate_type: string
          rico_case_id: string
          updated_at?: string
        }
        Update: {
          act_date?: string | null
          created_at?: string
          evidence_id?: string | null
          evidence_ref?: string | null
          id?: string
          note?: string | null
          predicate_type?: string
          rico_case_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "predicate_acts_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predicate_acts_rico_case_id_fkey"
            columns: ["rico_case_id"]
            isOneToOne: false
            referencedRelation: "rico_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          badge_number: string | null
          created_at: string
          discord_id: string | null
          display_name: string
          division: Database["public"]["Enums"]["bureau"]
          email: string | null
          id: string
          is_owner: boolean
          is_system: boolean
          is_test: boolean
          loa: boolean
          loa_since: string | null
          login_denied: boolean
          login_denied_at: string | null
          login_denied_by: string | null
          login_denied_reason: string | null
          removed_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          badge_number?: string | null
          created_at?: string
          discord_id?: string | null
          display_name?: string
          division?: Database["public"]["Enums"]["bureau"]
          email?: string | null
          id: string
          is_owner?: boolean
          is_system?: boolean
          is_test?: boolean
          loa?: boolean
          loa_since?: string | null
          login_denied?: boolean
          login_denied_at?: string | null
          login_denied_by?: string | null
          login_denied_reason?: string | null
          removed_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          badge_number?: string | null
          created_at?: string
          discord_id?: string | null
          display_name?: string
          division?: Database["public"]["Enums"]["bureau"]
          email?: string | null
          id?: string
          is_owner?: boolean
          is_system?: boolean
          is_test?: boolean
          loa?: boolean
          loa_since?: string | null
          login_denied?: boolean
          login_denied_at?: string | null
          login_denied_by?: string | null
          login_denied_reason?: string | null
          removed_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      raid_compensations: {
        Row: {
          bracket_pct: number
          case_id: string | null
          ci_amount: number
          created_at: string
          created_by: string | null
          id: string
          net_value: number
          primary_amount: number
          support_amount: number
          updated_at: string
        }
        Insert: {
          bracket_pct: number
          case_id?: string | null
          ci_amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          net_value: number
          primary_amount: number
          support_amount: number
          updated_at?: string
        }
        Update: {
          bracket_pct?: number
          case_id?: string | null
          ci_amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          net_value?: number
          primary_amount?: number
          support_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "raid_compensations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raid_compensations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_versions: {
        Row: {
          created_at: string
          created_by: string | null
          fields: Json
          id: string
          report_id: string
          signature: Json | null
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fields: Json
          id?: string
          report_id: string
          signature?: Json | null
          version_number: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fields?: Json
          id?: string
          report_id?: string
          signature?: Json | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          author_id: string | null
          case_id: string
          created_at: string
          fields: Json
          finalized: boolean
          id: string
          kind: Database["public"]["Enums"]["report_kind"]
          parent_id: string | null
          seq: number | null
          signature: Json | null
          template: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          case_id: string
          created_at?: string
          fields?: Json
          finalized?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["report_kind"]
          parent_id?: string | null
          seq?: number | null
          signature?: Json | null
          template: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          case_id?: string
          created_at?: string
          fields?: Json
          finalized?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["report_kind"]
          parent_id?: string | null
          seq?: number | null
          signature?: Json | null
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      rico_cases: {
        Row: {
          case_id: string
          created_at: string
          enterprise_gang_id: string | null
          id: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          enterprise_gang_id?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          enterprise_gang_id?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rico_cases_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rico_cases_enterprise_gang_id_fkey"
            columns: ["enterprise_gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
        ]
      }
      role_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          new_active: boolean | null
          new_division: Database["public"]["Enums"]["bureau"] | null
          new_role: Database["public"]["Enums"]["app_role"] | null
          old_active: boolean | null
          old_division: Database["public"]["Enums"]["bureau"] | null
          old_role: Database["public"]["Enums"]["app_role"] | null
          reason: string | null
          source: string | null
          source_id: string | null
          target_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          new_active?: boolean | null
          new_division?: Database["public"]["Enums"]["bureau"] | null
          new_role?: Database["public"]["Enums"]["app_role"] | null
          old_active?: boolean | null
          old_division?: Database["public"]["Enums"]["bureau"] | null
          old_role?: Database["public"]["Enums"]["app_role"] | null
          reason?: string | null
          source?: string | null
          source_id?: string | null
          target_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          new_active?: boolean | null
          new_division?: Database["public"]["Enums"]["bureau"] | null
          new_role?: Database["public"]["Enums"]["app_role"] | null
          old_active?: boolean | null
          old_division?: Database["public"]["Enums"]["bureau"] | null
          old_role?: Database["public"]["Enums"]["app_role"] | null
          reason?: string | null
          source?: string | null
          source_id?: string | null
          target_id?: string
        }
        Relationships: []
      }
      transfer_requests: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          decision_note: string | null
          from_bureau: Database["public"]["Enums"]["bureau"]
          from_role: Database["public"]["Enums"]["app_role"]
          id: string
          reason: string
          requested_by: string
          source_approved_at: string | null
          source_approved_by: string | null
          status: string
          target_approved_at: string | null
          target_approved_by: string | null
          target_id: string
          to_bureau: Database["public"]["Enums"]["bureau"]
          to_role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          decision_note?: string | null
          from_bureau: Database["public"]["Enums"]["bureau"]
          from_role: Database["public"]["Enums"]["app_role"]
          id?: string
          reason: string
          requested_by: string
          source_approved_at?: string | null
          source_approved_by?: string | null
          status?: string
          target_approved_at?: string | null
          target_approved_by?: string | null
          target_id: string
          to_bureau: Database["public"]["Enums"]["bureau"]
          to_role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          decision_note?: string | null
          from_bureau?: Database["public"]["Enums"]["bureau"]
          from_role?: Database["public"]["Enums"]["app_role"]
          id?: string
          reason?: string
          requested_by?: string
          source_approved_at?: string | null
          source_approved_by?: string | null
          status?: string
          target_approved_at?: string | null
          target_approved_by?: string | null
          target_id?: string
          to_bureau?: Database["public"]["Enums"]["bureau"]
          to_role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_requests_source_approved_by_fkey"
            columns: ["source_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_requests_target_approved_by_fkey"
            columns: ["target_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_requests_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_test_runs: {
        Row: {
          branch: string | null
          commit_sha: string | null
          created_at: string
          created_by: string | null
          duration_ms: number | null
          failed: number
          failures: Json
          id: string
          passed: number
          release: string | null
          skipped: number
          source: string
          suite: string
          total: number
        }
        Insert: {
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          failed?: number
          failures?: Json
          id?: string
          passed?: number
          release?: string | null
          skipped?: number
          source?: string
          suite: string
          total?: number
        }
        Update: {
          branch?: string | null
          commit_sha?: string | null
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          failed?: number
          failures?: Json
          id?: string
          passed?: number
          release?: string | null
          skipped?: number
          source?: string
          suite?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "security_test_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_reports: {
        Row: {
          arrests: number
          author_id: string
          author_name: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          cases_worked: string | null
          created_at: string
          evidence_count: number
          id: string
          notes: string | null
          updated_at: string
          week_start: string
        }
        Insert: {
          arrests?: number
          author_id?: string
          author_name?: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          cases_worked?: string | null
          created_at?: string
          evidence_count?: number
          id?: string
          notes?: string | null
          updated_at?: string
          week_start: string
        }
        Update: {
          arrests?: number
          author_id?: string
          author_name?: string | null
          bureau?: Database["public"]["Enums"]["bureau"]
          cases_worked?: string | null
          created_at?: string
          evidence_count?: number
          id?: string
          notes?: string | null
          updated_at?: string
          week_start?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          case_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          reported_dept: string | null
          routed_bureau: Database["public"]["Enums"]["bureau"] | null
          source: string | null
          status: string | null
          ticket_code: string
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          reported_dept?: string | null
          routed_bureau?: Database["public"]["Enums"]["bureau"] | null
          source?: string | null
          status?: string | null
          ticket_code: string
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          reported_dept?: string | null
          routed_bureau?: Database["public"]["Enums"]["bureau"] | null
          source?: string | null
          status?: string | null
          ticket_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trackers: {
        Row: {
          authorized_at: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          case_id: string | null
          created_at: string
          created_by: string | null
          deputy_sig: string | null
          director_sig: string | null
          duration_hours: number
          expires_at: string | null
          id: string
          status: Database["public"]["Enums"]["tracker_status"]
          target: string
          tracker_code: string
          updated_at: string
        }
        Insert: {
          authorized_at?: string | null
          bureau?: Database["public"]["Enums"]["bureau"]
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          deputy_sig?: string | null
          director_sig?: string | null
          duration_hours?: number
          expires_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["tracker_status"]
          target: string
          tracker_code: string
          updated_at?: string
        }
        Update: {
          authorized_at?: string | null
          bureau?: Database["public"]["Enums"]["bureau"]
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          deputy_sig?: string | null
          director_sig?: string | null
          duration_hours?: number
          expires_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["tracker_status"]
          target?: string
          tracker_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trackers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trackers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trackers_deputy_sig_fkey"
            columns: ["deputy_sig"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trackers_director_sig_fkey"
            columns: ["director_sig"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          gang_id: string | null
          id: string
          model: string | null
          notes: string | null
          owner_id: string | null
          plate: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          gang_id?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          owner_id?: string | null
          plate: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          gang_id?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          owner_id?: string | null
          plate?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_gang_id_fkey"
            columns: ["gang_id"]
            isOneToOne: false
            referencedRelation: "gangs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist: {
        Row: {
          created_at: string
          id: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          target_id: string
          target_type: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_legal_exhibit: {
        Args: {
          p_meta?: Json
          p_rationale?: string
          p_request: string
          p_source_id?: string
          p_title?: string
          p_type: string
        }
        Returns: Database["public"]["Tables"]["legal_request_exhibits"]["Row"]
      }
      admin_justice_membership_requests: {
        Args: never
        Returns: Database["public"]["Tables"]["justice_membership_requests"]["Row"][]
      }
      assign_ada_to_bureau: {
        Args: {
          p_bureau: Database["public"]["Enums"]["bureau"]
          p_note?: string
          p_prosecutor: string
          p_replace?: boolean
          p_type?: string
        }
        Returns: Database["public"]["Tables"]["prosecutor_bureau_assignments"]["Row"]
      }
      assign_judge: {
        Args: { p_judge: string; p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      claim_legal_request_as_judge: {
        Args: { p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      close_legal_request: {
        Args: { p_note?: string; p_outcome?: string; p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      create_legal_request: {
        Args: {
          p_case: string
          p_classification?: string
          p_form?: Json
          p_narrative?: string
          p_person?: string
          p_priority?: string
          p_recipient_name?: string
          p_recipient_type?: string
          p_request_type: string
          p_source_report?: string
          p_subtype: string
          p_title: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      import_legal_warrant: {
        Args: {
          p_case: string
          p_subtype: string
          p_title: string
          p_priority?: string
          p_form?: Json
          p_narrative?: string
          p_person?: string
          p_classification?: string
          p_source_submitted_at?: string
          p_source_submitter: string
          p_import_key: string
          p_exhibits?: Json
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      import_rollback_by_key: {
        Args: { p_import_key: string }
        Returns: number
      }
      decide_legal_request_as_judge: {
        Args: {
          p_conditions?: string
          p_decision: string
          p_expires_at?: string
          p_note?: string
          p_request: string
          p_signature?: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      doj_bureau_coverage: {
        Args: never
        Returns: {
          acting_id: string | null
          acting_name: string | null
          acting_role: string | null
          acting_since: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          covered: boolean
          primary_ada_id: string | null
          primary_ada_name: string | null
          primary_since: string | null
          supporting: Json
        }[]
      }
      end_ada_bureau_assignment: {
        Args: { p_assignment: string; p_note?: string }
        Returns: Database["public"]["Tables"]["prosecutor_bureau_assignments"]["Row"]
      }
      issue_legal_request: {
        Args: {
          p_expires_at?: string
          p_request: string
          p_response_deadline?: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      justice_membership_request_submit: {
        Args: { p_request: string }
        Returns: Database["public"]["Tables"]["justice_membership_requests"]["Row"]
      }
      justice_membership_request_withdraw: {
        Args: { p_request: string }
        Returns: Database["public"]["Tables"]["justice_membership_requests"]["Row"]
      }
      gang_member_add: {
        Args: {
          p_gang: string
          p_person: string
          p_rank?: string | null
          p_callsign?: string | null
          p_status?: string | null
          p_confidence?: string | null
          p_note?: string | null
          p_case?: string | null
        }
        Returns: string
      }
      gang_member_update: {
        Args: {
          p_member: string
          p_rank?: string | null
          p_callsign?: string | null
          p_status?: string | null
          p_confidence?: string | null
          p_note?: string | null
          p_case?: string | null
          p_joined_at?: string | null
          p_left_at?: string | null
          p_mark_reviewed?: boolean
        }
        Returns: undefined
      }
      gang_member_review: {
        Args: {
          p_member: string
          p_status?: string | null
          p_confidence?: string | null
        }
        Returns: undefined
      }
      justice_directory: {
        Args: never
        Returns: {
          active: boolean
          agency: string
          display_name: string
          justice_identifier: string | null
          justice_role: string
          user_id: string
        }[]
      }
      legal_hold_lift: {
        Args: { p_hold: string; p_reason?: string | null }
        Returns: Database["public"]["Tables"]["legal_holds"]["Row"]
      }
      legal_hold_place: {
        Args: { p_case?: string | null; p_legal_request?: string | null; p_reason: string }
        Returns: Database["public"]["Tables"]["legal_holds"]["Row"]
      }
      legal_request_people: {
        Args: { p_request: string }
        Returns: {
          display_name: string
          id: string
        }[]
      }
      legal_internal_notes: {
        Args: { p_request: string }
        Returns: {
          action: string
          actor_id: string
          created_at: string
          id: string
          internal_note: string
        }[]
      }
      legal_search: {
        Args: { q: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"][]
      }
      legal_seized_item_add: {
        Args: {
          p_request: string
          p_item: string
          p_quantity?: string | null
          p_category?: string | null
          p_evidence?: string | null
          p_person?: string | null
          p_vehicle?: string | null
          p_notes?: string | null
        }
        Returns: Database["public"]["Tables"]["legal_seized_items"]["Row"]
      }
      legal_seized_item_remove: {
        Args: { p_item: string }
        Returns: undefined
      }
      mdt_export_approve: {
        Args: { p_export: string }
        Returns: Database["public"]["Tables"]["mdt_exports"]["Row"]
      }
      mdt_export_clear: {
        Args: { p_export: string; p_reason?: string | null }
        Returns: Database["public"]["Tables"]["mdt_exports"]["Row"]
      }
      mdt_export_propose: {
        Args: {
          p_kind: string
          p_person: string | null
          p_vehicle: string | null
          p_snapshot: string
          p_wanted_status?: string | null
          p_risk?: string | null
          p_instructions?: string | null
          p_reason?: string | null
          p_case?: string | null
        }
        Returns: Database["public"]["Tables"]["mdt_exports"]["Row"]
      }
      mdt_wanted_current: {
        Args: never
        Returns: {
          classification_safe_warning: string | null
          effective_status: string
          expires_at: string | null
          issue_date: string | null
          issuing_judge_name: string | null
          legal_request_id: string
          person_id: string | null
          person_name_snapshot: string | null
          wanted_status: string
          warrant_reference: string
          warrant_type: string
        }[]
      }
      reassign_legal_ada: {
        Args: { p_new_ada: string; p_reason?: string; p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      record_subpoena_compliance: {
        Args: {
          p_date?: string
          p_non_compliance_reason?: string
          p_notes?: string
          p_request: string
          p_status: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      record_subpoena_service: {
        Args: {
          p_acknowledged?: boolean
          p_method?: string
          p_notes?: string
          p_request: string
          p_served_at?: string
          p_status: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      record_warrant_execution: {
        Args: {
          p_request: string
          p_outcome: string
          p_notes?: string | null
          p_result?: string | null
          p_executed_at?: string | null
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      record_warrant_return: {
        Args: { p_narrative: string; p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      remove_legal_exhibit: { Args: { p_exhibit: string }; Returns: undefined }
      resolve_case_originating_bureau: {
        Args: {
          p_bureau: Database["public"]["Enums"]["bureau"]
          p_case: string
        }
        Returns: Database["public"]["Tables"]["cases"]["Row"]
      }
      review_justice_membership_request: {
        Args: {
          p_applicant_note?: string
          p_decision: string
          p_final_agency?: string
          p_final_role?: string
          p_internal_note?: string
          p_request: string
        }
        Returns: Database["public"]["Tables"]["justice_membership_requests"]["Row"]
      }
      review_legal_request_as_ada: {
        Args: {
          p_decision: string
          p_judge?: string
          p_note?: string
          p_request: string
          p_signature?: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      review_legal_request_as_ag: {
        Args: {
          p_decision: string
          p_note?: string
          p_request: string
          p_signature?: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      review_legal_request_as_cid: {
        Args: {
          p_decision: string
          p_note?: string
          p_override_reason?: string
          p_request: string
          p_signature?: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      review_legal_request_as_da: {
        Args: {
          p_decision: string
          p_note?: string
          p_request: string
          p_signature?: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      set_acting_ada: {
        Args: {
          p_bureau: Database["public"]["Enums"]["bureau"]
          p_note?: string
          p_prosecutor: string
        }
        Returns: Database["public"]["Tables"]["prosecutor_bureau_assignments"]["Row"]
      }
      set_justice_membership_active: {
        Args: { p_active: boolean; p_target: string }
        Returns: Database["public"]["Tables"]["justice_memberships"]["Row"]
      }
      set_legal_approval_route: {
        Args: { p_reason: string; p_request: string; p_route: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      set_primary_ada: {
        Args: {
          p_bureau: Database["public"]["Enums"]["bureau"]
          p_note?: string
          p_prosecutor: string
        }
        Returns: Database["public"]["Tables"]["prosecutor_bureau_assignments"]["Row"]
      }
      submit_legal_request_to_cid: {
        Args: { p_change_summary?: string; p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      submit_legal_request_to_doj: {
        Args: { p_ada?: string; p_reason?: string; p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      update_legal_draft: {
        Args: {
          p_classification?: string
          p_form?: Json
          p_narrative?: string
          p_person?: string
          p_priority?: string
          p_recipient_name?: string
          p_recipient_type?: string
          p_request: string
          p_title?: string
        }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      withdraw_legal_request: {
        Args: { p_note?: string; p_request: string }
        Returns: Database["public"]["Tables"]["legal_requests"]["Row"]
      }
      owner_security_overview: {
        Args: never
        Returns: Json
      }
      security_test_report: {
        Args: {
          p_branch?: string
          p_commit?: string
          p_duration_ms?: number
          p_failed: number
          p_failures?: Json
          p_passed: number
          p_release?: string
          p_skipped: number
          p_source?: string
          p_suite: string
        }
        Returns: string
      }
      admin_member_emails: {
        Args: never
        Returns: {
          email: string
          id: string
        }[]
      }
      admin_membership_requests: {
        Args: never
        Returns: Database["public"]["Tables"]["membership_requests"]["Row"][]
      }
      admin_remove_member: { Args: { p_target: string; p_reason?: string }; Returns: undefined }
      admin_restore_member: { Args: { p_target: string }; Returns: undefined }
      announcement_notify_update: {
        Args: { p_announce: string }
        Returns: number
      }
      announcement_recipient_count: {
        Args: { p_audience: string; p_mentions?: Json }
        Returns: number
      }
      case_reassign_bureau: {
        Args: {
          p_case: string
          p_reason: string
          p_to_bureau: Database["public"]["Enums"]["bureau"]
          p_update_originating?: boolean
        }
        Returns: Database["public"]["Tables"]["cases"]["Row"]
      }
      convert_case_to_joint: {
        Args: { p_case: string; p_members: Json; p_note?: string }
        Returns: Json
      }
      deny_member_login: {
        Args: { p_reason: string; p_target: string }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
      }
      restore_member_login: {
        Args: { p_target: string }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
      }
      joint_case_add_members: {
        Args: { p_case: string; p_members: Json }
        Returns: Json
      }
      joint_case_end: {
        Args: { p_case: string; p_note?: string }
        Returns: undefined
      }
      joint_case_remove_member: {
        Args: { p_case: string; p_officer: string; p_reason?: string }
        Returns: undefined
      }
      membership_request_submit: {
        Args: { p_request: string }
        Returns: Database["public"]["Tables"]["membership_requests"]["Row"]
      }
      membership_request_withdraw: {
        Args: { p_request: string }
        Returns: Database["public"]["Tables"]["membership_requests"]["Row"]
      }
      publish_announcement: {
        Args: {
          p_audience: string
          p_body: string
          p_links?: Json
          p_mentions?: Json
          p_pinned?: boolean
          p_title: string
        }
        Returns: Json
      }
      review_membership_request: {
        Args: {
          p_applicant_note?: string
          p_decision: string
          p_final_bureau?: Database["public"]["Enums"]["bureau"]
          p_final_role?: Database["public"]["Enums"]["app_role"]
          p_internal_note?: string
          p_request: string
        }
        Returns: Database["public"]["Tables"]["membership_requests"]["Row"]
      }
      assign_member: {
        Args: {
          set_active: boolean
          target: string
        }
        Returns: undefined
      }
      change_member_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["app_role"]
          p_reason: string
          p_target: string
        }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
      }
      request_transfer: {
        Args: {
          p_reason: string
          p_target: string
          p_to_bureau: Database["public"]["Enums"]["bureau"]
          p_to_role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: Database["public"]["Tables"]["transfer_requests"]["Row"]
      }
      approve_transfer_source: {
        Args: { p_id: string; p_note?: string }
        Returns: Database["public"]["Tables"]["transfer_requests"]["Row"]
      }
      approve_transfer_target: {
        Args: { p_id: string; p_note?: string }
        Returns: Database["public"]["Tables"]["transfer_requests"]["Row"]
      }
      complete_transfer: {
        Args: { p_id: string }
        Returns: Database["public"]["Tables"]["transfer_requests"]["Row"]
      }
      reject_transfer: {
        Args: { p_id: string; p_note?: string }
        Returns: Database["public"]["Tables"]["transfer_requests"]["Row"]
      }
      cancel_transfer: {
        Args: { p_id: string }
        Returns: Database["public"]["Tables"]["transfer_requests"]["Row"]
      }
      case_archive: {
        Args: { p_case: string; p_note?: string }
        Returns: Database["public"]["Tables"]["cases"]["Row"]
      }
      case_delete_preview: {
        Args: { p_case: string }
        Returns: Json
      }
      case_permanent_delete: {
        Args: { p_case: string; p_reason: string }
        Returns: undefined
      }
      case_restore: {
        Args: { p_case: string }
        Returns: Database["public"]["Tables"]["cases"]["Row"]
      }
      correct_membership_organization: {
        Args: {
          p_direction: string
          p_reason: string
          p_requested_bureau?: Database["public"]["Enums"]["bureau"]
          p_requested_justice_role?: string
          p_requested_role?: Database["public"]["Enums"]["app_role"]
          p_target: string
        }
        Returns: Json
      }
      owner_grant_justice_membership: {
        Args: {
          p_agency: string
          p_justice_role: string
          p_reason: string
          p_target: string
        }
        Returns: undefined
      }
      set_profile_test_flag: {
        Args: { p_is_test: boolean; p_target: string }
        Returns: undefined
      }
      permanent_delete_preview: {
        Args: { p_target: string }
        Returns: Json
      }
      permanent_delete_arm: {
        Args: { p_reason: string; p_target: string }
        Returns: Json
      }
      permanent_delete_execute: {
        Args: { p_confirm: string; p_token: string }
        Returns: Json
      }
      rls_test_spawn_disposable: {
        Args: { p_suffix: string }
        Returns: string
      }
      rls_test_reset_member: {
        Args: {
          p_active: boolean
          p_division: Database["public"]["Enums"]["bureau"]
          p_role: Database["public"]["Enums"]["app_role"]
          p_target: string
        }
        Returns: undefined
      }
      create_notification: {
        Args: { p_payload?: Json; p_type: string; p_user_id: string }
        Returns: undefined
      }
      mo_crossref: {
        Args: { terms: string[] }
        Returns: {
          bureau: Database["public"]["Enums"]["bureau"]
          case_id: string
          case_number: string
          shared: string[]
        }[]
      }
      report_finalize: {
        Args: { p_badge?: string; p_report: string }
        Returns: {
          author_id: string | null
          case_id: string
          created_at: string
          fields: Json
          finalized: boolean
          id: string
          kind: Database["public"]["Enums"]["report_kind"]
          parent_id: string | null
          seq: number | null
          signature: Json | null
          template: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_reopen: {
        Args: { p_report: string }
        Returns: {
          author_id: string | null
          case_id: string
          created_at: string
          fields: Json
          finalized: boolean
          id: string
          kind: Database["public"]["Enums"]["report_kind"]
          parent_id: string | null
          seq: number | null
          signature: Json | null
          template: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      warrant_set_status: {
        Args: { p_report: string; p_status: string }
        Returns: {
          author_id: string | null
          case_id: string
          created_at: string
          fields: Json
          finalized: boolean
          id: string
          kind: Database["public"]["Enums"]["report_kind"]
          parent_id: string | null
          seq: number | null
          signature: Json | null
          template: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      person_merge: {
        Args: { p_reason: string; p_survivor: string; p_victims: string[] }
        Returns: undefined
      }
      search_all: {
        Args: { q: string }
        Returns: {
          id: string
          kind: string
          label: string
          rank: number
          sublabel: string
          term: string
        }[]
      }
      search_persons: {
        Args: { p_limit?: number; p_offset?: number; p_q: string }
        Returns: {
          id: string
          rank: number
        }[]
      }
      signoff_decide: {
        Args: { p_case: string; p_decision: string; p_note?: string }
        Returns: {
          area: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          case_number: string
          charges: Json
          closed_at: string | null
          created_at: string
          created_by: string | null
          follow_up_at: string | null
          id: string
          last_stale_notified_at: string | null
          lead_detective_id: string | null
          notes: string | null
          operation_id: string | null
          signoff_assignee_id: string | null
          signoff_stage: string | null
          signoff_status: string
          signoff_submitted_at: string | null
          signoff_submitted_by: string | null
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      signoff_owner_action: {
        Args: { p_action: string; p_case: string }
        Returns: {
          area: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          case_number: string
          charges: Json
          closed_at: string | null
          created_at: string
          created_by: string | null
          follow_up_at: string | null
          id: string
          last_stale_notified_at: string | null
          lead_detective_id: string | null
          notes: string | null
          operation_id: string | null
          signoff_assignee_id: string | null
          signoff_stage: string | null
          signoff_status: string
          signoff_submitted_at: string | null
          signoff_submitted_by: string | null
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      signoff_command_override: {
        Args: { p_action: string; p_case: string; p_reason: string }
        Returns: {
          area: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          case_number: string
          charges: Json
          closed_at: string | null
          created_at: string
          created_by: string | null
          follow_up_at: string | null
          id: string
          last_stale_notified_at: string | null
          lead_detective_id: string | null
          notes: string | null
          operation_id: string | null
          signoff_assignee_id: string | null
          signoff_stage: string | null
          signoff_status: string
          signoff_submitted_at: string | null
          signoff_submitted_by: string | null
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rls_test_set_signoff: {
        Args: { p_case: string; p_stage?: string; p_status: string }
        Returns: undefined
      }
      signoff_submit: {
        Args: { p_case: string }
        Returns: {
          area: string | null
          bureau: Database["public"]["Enums"]["bureau"]
          case_number: string
          charges: Json
          closed_at: string | null
          created_at: string
          created_by: string | null
          follow_up_at: string | null
          id: string
          last_stale_notified_at: string | null
          lead_detective_id: string | null
          notes: string | null
          operation_id: string | null
          signoff_assignee_id: string | null
          signoff_stage: string | null
          signoff_status: string
          signoff_submitted_at: string | null
          signoff_submitted_by: string | null
          status: Database["public"]["Enums"]["case_status"]
          summary: string | null
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      acknowledge_document: {
        Args: { p_document: string }
        Returns: Database["public"]["Tables"]["document_acknowledgements"]["Row"]
      }
      close_reading_campaign: {
        Args: { p_campaign: string; p_reason?: string }
        Returns: Database["public"]["Tables"]["document_reading_campaigns"]["Row"]
      }
      document_ack_summary: {
        Args: { p_document: string }
        Returns: {
          acknowledged_at: string | null
          display_name: string
          user_id: string
        }[]
      }
      document_record_review: {
        Args: {
          p_document: string
          p_next_due?: string
          p_note?: string
          p_outcome: string
        }
        Returns: Database["public"]["Tables"]["documents"]["Row"]
      }
      document_restore_version: {
        Args: { p_document: string; p_reason: string; p_version: string }
        Returns: Database["public"]["Tables"]["documents"]["Row"]
      }
      document_save: {
        Args: {
          p_body: string
          p_change_summary?: string
          p_change_type?: string
          p_document: string
          p_name: string
          p_requires_reack?: boolean
        }
        Returns: Database["public"]["Tables"]["documents"]["Row"]
      }
      document_workflow: {
        Args: {
          p_action: string
          p_document: string
          p_effective_at?: string
          p_reason?: string
          p_replacement?: string
        }
        Returns: Database["public"]["Tables"]["documents"]["Row"]
      }
      publish_reading_campaign: {
        Args: {
          p_audience: string
          p_deadline?: string
          p_document: string
          p_reason?: string
          p_targets?: Json
        }
        Returns: Database["public"]["Tables"]["document_reading_campaigns"]["Row"]
      }
      resolve_document_sync: {
        Args: { p_document: string; p_reason: string; p_resolution: string }
        Returns: Database["public"]["Tables"]["documents"]["Row"]
      }
      search_documents: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          category: string | null
          classification: string
          document_type: string
          headline: string | null
          id: string
          mandatory: boolean
          name: string
          rank: number
          status: string
          updated_at: string
        }[]
      }
      submit_document_suggestion: {
        Args: {
          p_document: string
          p_explanation: string
          p_proposed_text?: string
          p_related_case?: string
          p_section_id?: string
          p_section_title?: string
          p_source_url?: string
          p_title: string
          p_type: string
        }
        Returns: Database["public"]["Tables"]["document_suggestions"]["Row"]
      }
      decide_document_suggestion: {
        Args: {
          p_assigned_editor?: string
          p_note?: string
          p_status: string
          p_suggestion: string
        }
        Returns: Database["public"]["Tables"]["document_suggestions"]["Row"]
      }
      comment_on_document_suggestion: {
        Args: { p_body: string; p_suggestion: string }
        Returns: Database["public"]["Tables"]["document_suggestion_comments"]["Row"]
      }
      mark_document_suggestion_duplicate: {
        Args: { p_note?: string; p_original: string; p_suggestion: string }
        Returns: Database["public"]["Tables"]["document_suggestions"]["Row"]
      }
      link_document_suggestion_implementation: {
        Args: { p_suggestion: string; p_version: string }
        Returns: Database["public"]["Tables"]["document_suggestions"]["Row"]
      }
      merge_narcotics: {
        Args: { p_merged: string; p_reason: string; p_survivor: string }
        Returns: Database["public"]["Tables"]["narcotics"]["Row"]
      }
      resolve_provisional_narcotic: {
        Args: {
          p_action: string
          p_canonical?: string
          p_note?: string
          p_provisional: string
        }
        Returns: Database["public"]["Tables"]["narcotics"]["Row"]
      }
      submit_narcotic_suggestion: {
        Args: {
          p_explanation: string
          p_narcotic: string
          p_proposed_value?: string
          p_source_case?: string
          p_source_evidence?: string
          p_source_report?: string
          p_title: string
          p_type: string
        }
        Returns: Database["public"]["Tables"]["narcotic_suggestions"]["Row"]
      }
      decide_narcotic_suggestion: {
        Args: { p_note?: string; p_status: string; p_suggestion: string }
        Returns: Database["public"]["Tables"]["narcotic_suggestions"]["Row"]
      }
      search_narcotics: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          category: string
          confidence: string | null
          id: string
          name: string
          rank: number
          restricted: boolean
          status: string
        }[]
      }
      add_narcotic_sale_observation: {
        Args: { p_observation: Json; p_series: string; p_stacks?: Json }
        Returns: string
      }
      confirm_narcotic_sale_observation: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "detective"
        | "supervisor"
        | "director"
        | "command"
        | "senior_detective"
        | "bureau_lead"
        | "deputy_director"
      assign_role: "primary" | "support"
      bench_type: "street" | "organized"
      bureau: "LSB" | "BCB" | "SAB" | "JTF"
      case_status: "open" | "active" | "cold" | "closed"
      density: "low" | "medium" | "high"
      doc_kind: "doc" | "sheet" | "pdf" | "zip"
      evidence_tamper: "intact" | "compromised" | "released" | "destroyed"
      location_type:
        | "drug_lab"
        | "stash_house"
        | "dead_drop"
        | "front_business"
        | "chop_shop"
      media_type: "image" | "video" | "fivemanage" | "document"
      report_kind: "initial" | "supplemental" | "followup"
      threat_level: "low" | "medium" | "high"
      tracker_status: "pending" | "authorized" | "expired"
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
      app_role: [
        "detective",
        "supervisor",
        "director",
        "command",
        "senior_detective",
        "bureau_lead",
        "deputy_director",
      ],
      assign_role: ["primary", "support"],
      bench_type: ["street", "organized"],
      bureau: ["LSB", "BCB", "SAB", "JTF"],
      case_status: ["open", "active", "cold", "closed"],
      density: ["low", "medium", "high"],
      doc_kind: ["doc", "sheet", "pdf", "zip"],
      evidence_tamper: ["intact", "compromised", "released", "destroyed"],
      location_type: [
        "drug_lab",
        "stash_house",
        "dead_drop",
        "front_business",
        "chop_shop",
      ],
      media_type: ["image", "video", "fivemanage", "document"],
      report_kind: ["initial", "supplemental", "followup"],
      threat_level: ["low", "medium", "high"],
      tracker_status: ["pending", "authorized", "expired"],
    },
  },
} as const
