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
          id: string
          note: string | null
          stage: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          case_id: string
          created_at?: string
          id?: string
          note?: string | null
          stage?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          case_id?: string
          created_at?: string
          id?: string
          note?: string | null
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
      documents: {
        Row: {
          case_id: string | null
          content: Json | null
          created_at: string
          folder: string
          id: string
          kind: Database["public"]["Enums"]["doc_kind"]
          modified_label: string | null
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          case_id?: string | null
          content?: Json | null
          created_at?: string
          folder: string
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"]
          modified_label?: string | null
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          case_id?: string | null
          content?: Json | null
          created_at?: string
          folder?: string
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"]
          modified_label?: string | null
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
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
          content: Json | null
          document_id: string
          id: string
          kind: Database["public"]["Enums"]["doc_kind"] | null
          modified_label: string | null
          name: string | null
          saved_at: string
          saved_by: string | null
        }
        Insert: {
          content?: Json | null
          document_id: string
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"] | null
          modified_label?: string | null
          name?: string | null
          saved_at?: string
          saved_by?: string | null
        }
        Update: {
          content?: Json | null
          document_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["doc_kind"] | null
          modified_label?: string | null
          name?: string | null
          saved_at?: string
          saved_by?: string | null
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
          created_at: string
          felony_count: number | null
          gang_id: string
          id: string
          mugshot_url: string | null
          name: string
          person_id: string | null
          rank: string | null
          rank_id: string | null
          status: string | null
          updated_at: string
          vch: number | null
        }
        Insert: {
          callsign?: string | null
          case_id?: string | null
          ccw?: boolean | null
          created_at?: string
          felony_count?: number | null
          gang_id: string
          id?: string
          mugshot_url?: string | null
          name: string
          person_id?: string | null
          rank?: string | null
          rank_id?: string | null
          status?: string | null
          updated_at?: string
          vch?: number | null
        }
        Update: {
          callsign?: string | null
          case_id?: string | null
          ccw?: boolean | null
          created_at?: string
          felony_count?: number | null
          gang_id?: string
          id?: string
          mugshot_url?: string | null
          name?: string
          person_id?: string | null
          rank?: string | null
          rank_id?: string | null
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
          created_at: string
          density: Database["public"]["Enums"]["density"]
          gang_id: string
          hotspot_area: string | null
          id: string
        }
        Insert: {
          block: string
          created_at?: string
          density?: Database["public"]["Enums"]["density"]
          gang_id: string
          hotspot_area?: string | null
          id?: string
        }
        Update: {
          block?: string
          created_at?: string
          density?: Database["public"]["Enums"]["density"]
          gang_id?: string
          hotspot_area?: string | null
          id?: string
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
          colors: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          threat_level: Database["public"]["Enums"]["threat_level"]
          updated_at: string
        }
        Insert: {
          colors?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          threat_level?: Database["public"]["Enums"]["threat_level"]
          updated_at?: string
        }
        Update: {
          colors?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
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
      media: {
        Row: {
          case_id: string | null
          created_at: string
          external_url: string | null
          gang_id: string | null
          id: string
          kind: string | null
          person_id: string | null
          place_id: string | null
          storage_path: string | null
          tags: Json | null
          title: string
          type: Database["public"]["Enums"]["media_type"]
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          external_url?: string | null
          gang_id?: string | null
          id?: string
          kind?: string | null
          person_id?: string | null
          place_id?: string | null
          storage_path?: string | null
          tags?: Json | null
          title: string
          type: Database["public"]["Enums"]["media_type"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          case_id?: string | null
          created_at?: string
          external_url?: string | null
          gang_id?: string | null
          id?: string
          kind?: string | null
          person_id?: string | null
          place_id?: string | null
          storage_path?: string | null
          tags?: Json | null
          title?: string
          type?: Database["public"]["Enums"]["media_type"]
          updated_at?: string
          uploaded_by?: string | null
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
            foreignKeyName: "media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          classification: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          popularity: number | null
          street_price: number | null
          updated_at: string
          wholesale_price: number | null
        }
        Insert: {
          classification?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          popularity?: number | null
          street_price?: number | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Update: {
          classification?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          popularity?: number | null
          street_price?: number | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Relationships: []
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
      persons: {
        Row: {
          alias: string | null
          bolo: boolean
          ccw: boolean | null
          created_at: string
          created_by: string | null
          dob: string | null
          felony_count: number | null
          gang_id: string | null
          id: string
          mugshot_url: string | null
          name: string
          notes: string | null
          properties: Json
          status: string | null
          updated_at: string
          vch: number | null
        }
        Insert: {
          alias?: string | null
          bolo?: boolean
          ccw?: boolean | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          felony_count?: number | null
          gang_id?: string | null
          id?: string
          mugshot_url?: string | null
          name: string
          notes?: string | null
          properties?: Json
          status?: string | null
          updated_at?: string
          vch?: number | null
        }
        Update: {
          alias?: string | null
          bolo?: boolean
          ccw?: boolean | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          felony_count?: number | null
          gang_id?: string | null
          id?: string
          mugshot_url?: string | null
          name?: string
          notes?: string | null
          properties?: Json
          status?: string | null
          updated_at?: string
          vch?: number | null
        }
        Relationships: [
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
          loa: boolean
          loa_since: string | null
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
          loa?: boolean
          loa_since?: string | null
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
          loa?: boolean
          loa_since?: string | null
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
          target_id?: string
        }
        Relationships: []
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
      admin_remove_member: { Args: { p_target: string }; Returns: undefined }
      admin_restore_member: { Args: { p_target: string }; Returns: undefined }
      announcement_notify_update: {
        Args: { p_announce: string }
        Returns: number
      }
      announcement_recipient_count: {
        Args: { p_audience: string; p_mentions?: Json }
        Returns: number
      }
      convert_case_to_joint: {
        Args: { p_case: string; p_members: Json; p_note?: string }
        Returns: Json
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
          new_division: Database["public"]["Enums"]["bureau"]
          new_role: Database["public"]["Enums"]["app_role"]
          set_active: boolean
          target: string
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
