// Generated from the live Supabase schema (information_schema) — project jhxuflzmqspidkvjckox.
// Regenerate with `supabase gen types typescript` when the schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      announcements: {
        Row: {
          id: string
          author_id: string | null
          author_name: string | null
          title: string
          body: string
          audience: string
          pinned: boolean
          created_at: string
          updated_at: string
          links: Json
          mentions: Json
        }
        Insert: {
          id?: string
          author_id?: string | null
          author_name?: string | null
          title: string
          body: string
          audience?: string
          pinned?: boolean
          created_at?: string
          updated_at?: string
          links?: Json
          mentions?: Json
        }
        Update: {
          id?: string
          author_id?: string | null
          author_name?: string | null
          title?: string
          body?: string
          audience?: string
          pinned?: boolean
          created_at?: string
          updated_at?: string
          links?: Json
          mentions?: Json
        }
      }
      audit_log: {
        Row: {
          id: number
          actor_id: string | null
          action: string
          entity: string
          entity_id: string | null
          detail: Json | null
          created_at: string
        }
        Insert: {
          id: number
          actor_id?: string | null
          action: string
          entity: string
          entity_id?: string | null
          detail?: Json | null
          created_at?: string
        }
        Update: {
          id?: number
          actor_id?: string | null
          action?: string
          entity?: string
          entity_id?: string | null
          detail?: Json | null
          created_at?: string
        }
      }
      ballistic_footprints: {
        Row: {
          id: string
          signature: string
          weapon: string | null
          gang_id: string | null
          case_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          signature: string
          weapon?: string | null
          gang_id?: string | null
          case_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          signature?: string
          weapon?: string | null
          gang_id?: string | null
          case_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      ballistics_benches: {
        Row: {
          id: string
          bench_type: Database['public']['Enums']['bench_type']
          name: string
          tier: string | null
          heat: string | null
          outputs: string[] | null
          components: string[] | null
          case_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          bench_type: Database['public']['Enums']['bench_type']
          name: string
          tier?: string | null
          heat?: string | null
          outputs?: string[] | null
          components?: string[] | null
          case_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          bench_type?: Database['public']['Enums']['bench_type']
          name?: string
          tier?: string | null
          heat?: string | null
          outputs?: string[] | null
          components?: string[] | null
          case_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      case_access_grants: {
        Row: {
          id: string
          case_id: string
          officer_id: string
          granted_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          officer_id: string
          granted_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          officer_id?: string
          granted_by?: string | null
          created_at?: string
        }
      }
      case_access_requests: {
        Row: {
          id: string
          case_id: string
          requester_id: string
          requester_name: string | null
          reason: string | null
          status: string
          decided_by: string | null
          decided_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          requester_id?: string
          requester_name?: string | null
          reason?: string | null
          status?: string
          decided_by?: string | null
          decided_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          requester_id?: string
          requester_name?: string | null
          reason?: string | null
          status?: string
          decided_by?: string | null
          decided_at?: string | null
          created_at?: string
        }
      }
      case_assignments: {
        Row: {
          id: string
          case_id: string
          officer_id: string
          role: Database['public']['Enums']['assign_role']
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          officer_id: string
          role?: Database['public']['Enums']['assign_role']
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          officer_id?: string
          role?: Database['public']['Enums']['assign_role']
          created_at?: string
        }
      }
      case_files: {
        Row: {
          id: string
          case_number: string
          drive_file_id: string
          name: string
          mime_type: string | null
          icon_url: string | null
          web_view_link: string
          added_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_number: string
          drive_file_id: string
          name: string
          mime_type?: string | null
          icon_url?: string | null
          web_view_link: string
          added_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_number?: string
          drive_file_id?: string
          name?: string
          mime_type?: string | null
          icon_url?: string | null
          web_view_link?: string
          added_by?: string | null
          created_at?: string
        }
      }
      case_intel_links: {
        Row: {
          id: string
          case_id: string
          kind: string
          ref_id: string
          role: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          kind: string
          ref_id: string
          role?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          kind?: string
          ref_id?: string
          role?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      case_messages: {
        Row: {
          id: string
          case_id: string
          author_id: string | null
          author_name: string | null
          body: string
          mentions: Json
          links: Json
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          author_id?: string | null
          author_name?: string | null
          body: string
          mentions?: Json
          links?: Json
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          author_id?: string | null
          author_name?: string | null
          body?: string
          mentions?: Json
          links?: Json
          created_at?: string
        }
      }
      case_signoff_history: {
        Row: {
          id: string
          case_id: string
          actor_id: string | null
          actor_name: string | null
          action: string
          stage: string | null
          to_status: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          actor_id?: string | null
          actor_name?: string | null
          action: string
          stage?: string | null
          to_status?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          actor_id?: string | null
          actor_name?: string | null
          action?: string
          stage?: string | null
          to_status?: string | null
          note?: string | null
          created_at?: string
        }
      }
      case_tasks: {
        Row: {
          id: string
          case_id: string
          title: string
          assignee: string | null
          due: string | null
          done: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          title: string
          assignee?: string | null
          due?: string | null
          done?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          title?: string
          assignee?: string | null
          due?: string | null
          done?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      case_templates: {
        Row: {
          id: string
          name: string
          icon: string | null
          bureau: Database['public']['Enums']['bureau'] | null
          title: string | null
          summary: string | null
          area: string | null
          status: Database['public']['Enums']['case_status']
          sort_order: number
          active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          icon?: string | null
          bureau?: Database['public']['Enums']['bureau'] | null
          title?: string | null
          summary?: string | null
          area?: string | null
          status?: Database['public']['Enums']['case_status']
          sort_order?: number
          active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          icon?: string | null
          bureau?: Database['public']['Enums']['bureau'] | null
          title?: string | null
          summary?: string | null
          area?: string | null
          status?: Database['public']['Enums']['case_status']
          sort_order?: number
          active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      cases: {
        Row: {
          id: string
          case_number: string
          title: string | null
          bureau: Database['public']['Enums']['bureau']
          status: Database['public']['Enums']['case_status']
          lead_detective_id: string | null
          summary: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          signoff_status: string
          signoff_stage: string | null
          signoff_assignee_id: string | null
          signoff_submitted_by: string | null
          signoff_submitted_at: string | null
          closed_at: string | null
          area: string | null
          last_stale_notified_at: string | null
          charges: Json
          follow_up_at: string | null
        }
        Insert: {
          id?: string
          case_number: string
          title?: string | null
          bureau?: Database['public']['Enums']['bureau']
          status?: Database['public']['Enums']['case_status']
          lead_detective_id?: string | null
          summary?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          signoff_status?: string
          signoff_stage?: string | null
          signoff_assignee_id?: string | null
          signoff_submitted_by?: string | null
          signoff_submitted_at?: string | null
          closed_at?: string | null
          area?: string | null
          last_stale_notified_at?: string | null
          charges?: Json
          follow_up_at?: string | null
        }
        Update: {
          id?: string
          case_number?: string
          title?: string | null
          bureau?: Database['public']['Enums']['bureau']
          status?: Database['public']['Enums']['case_status']
          lead_detective_id?: string | null
          summary?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          signoff_status?: string
          signoff_stage?: string | null
          signoff_assignee_id?: string | null
          signoff_submitted_by?: string | null
          signoff_submitted_at?: string | null
          closed_at?: string | null
          area?: string | null
          last_stale_notified_at?: string | null
          charges?: Json
          follow_up_at?: string | null
        }
      }
      cid_records: {
        Row: {
          id: string
          name: string
          callsign: string | null
          case_number: string | null
          charges: string | null
          status: string
          officer: string | null
          notes: string | null
          mugshot_url: string | null
          gang: string | null
          bureau: string | null
          last_seen: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          callsign?: string | null
          case_number?: string | null
          charges?: string | null
          status?: string
          officer?: string | null
          notes?: string | null
          mugshot_url?: string | null
          gang?: string | null
          bureau?: string | null
          last_seen?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          callsign?: string | null
          case_number?: string | null
          charges?: string | null
          status?: string
          officer?: string | null
          notes?: string | null
          mugshot_url?: string | null
          gang?: string | null
          bureau?: string | null
          last_seen?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      commendations: {
        Row: {
          id: string
          title: string
          recipient_id: string | null
          recipient_name: string | null
          note: string | null
          icon: string | null
          tint: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          recipient_id?: string | null
          recipient_name?: string | null
          note?: string | null
          icon?: string | null
          tint?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          recipient_id?: string | null
          recipient_name?: string | null
          note?: string | null
          icon?: string | null
          tint?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      custody_chain: {
        Row: {
          id: string
          evidence_id: string
          from_officer: string | null
          to_officer: string | null
          reason: string | null
          transferred_by: string | null
          at: string
        }
        Insert: {
          id?: string
          evidence_id: string
          from_officer?: string | null
          to_officer?: string | null
          reason?: string | null
          transferred_by?: string | null
          at?: string
        }
        Update: {
          id?: string
          evidence_id?: string
          from_officer?: string | null
          to_officer?: string | null
          reason?: string | null
          transferred_by?: string | null
          at?: string
        }
      }
      documents: {
        Row: {
          id: string
          folder: string
          name: string
          kind: Database['public']['Enums']['doc_kind']
          content: Json | null
          case_id: string | null
          modified_label: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          folder: string
          name: string
          kind?: Database['public']['Enums']['doc_kind']
          content?: Json | null
          case_id?: string | null
          modified_label?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          folder?: string
          name?: string
          kind?: Database['public']['Enums']['doc_kind']
          content?: Json | null
          case_id?: string | null
          modified_label?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      documents_versions: {
        Row: {
          id: string
          document_id: string
          name: string | null
          kind: Database['public']['Enums']['doc_kind'] | null
          content: Json | null
          modified_label: string | null
          saved_by: string | null
          saved_at: string
        }
        Insert: {
          id?: string
          document_id: string
          name?: string | null
          kind?: Database['public']['Enums']['doc_kind'] | null
          content?: Json | null
          modified_label?: string | null
          saved_by?: string | null
          saved_at?: string
        }
        Update: {
          id?: string
          document_id?: string
          name?: string | null
          kind?: Database['public']['Enums']['doc_kind'] | null
          content?: Json | null
          modified_label?: string | null
          saved_by?: string | null
          saved_at?: string
        }
      }
      evidence: {
        Row: {
          id: string
          case_id: string | null
          item_code: string | null
          type: string | null
          description: string | null
          collected_by: string | null
          collected_at: string | null
          location: string | null
          tamper: Database['public']['Enums']['evidence_tamper']
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id?: string | null
          item_code?: string | null
          type?: string | null
          description?: string | null
          collected_by?: string | null
          collected_at?: string | null
          location?: string | null
          tamper?: Database['public']['Enums']['evidence_tamper']
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string | null
          item_code?: string | null
          type?: string | null
          description?: string | null
          collected_by?: string | null
          collected_at?: string | null
          location?: string | null
          tamper?: Database['public']['Enums']['evidence_tamper']
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      feedback: {
        Row: {
          id: string
          kind: string
          title: string
          details: string | null
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          kind?: string
          title: string
          details?: string | null
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          kind?: string
          title?: string
          details?: string | null
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      gang_members: {
        Row: {
          id: string
          gang_id: string
          rank_id: string | null
          person_id: string | null
          case_id: string | null
          name: string
          callsign: string | null
          ccw: boolean | null
          vch: number | null
          felony_count: number | null
          status: string | null
          mugshot_url: string | null
          created_at: string
          updated_at: string
          rank: string | null
        }
        Insert: {
          id?: string
          gang_id: string
          rank_id?: string | null
          person_id?: string | null
          case_id?: string | null
          name: string
          callsign?: string | null
          ccw?: boolean | null
          vch?: number | null
          felony_count?: number | null
          status?: string | null
          mugshot_url?: string | null
          created_at?: string
          updated_at?: string
          rank?: string | null
        }
        Update: {
          id?: string
          gang_id?: string
          rank_id?: string | null
          person_id?: string | null
          case_id?: string | null
          name?: string
          callsign?: string | null
          ccw?: boolean | null
          vch?: number | null
          felony_count?: number | null
          status?: string | null
          mugshot_url?: string | null
          created_at?: string
          updated_at?: string
          rank?: string | null
        }
      }
      gang_ranks: {
        Row: {
          id: string
          gang_id: string
          name: string
          sort_order: number | null
        }
        Insert: {
          id?: string
          gang_id: string
          name: string
          sort_order?: number | null
        }
        Update: {
          id?: string
          gang_id?: string
          name?: string
          sort_order?: number | null
        }
      }
      gang_turf: {
        Row: {
          id: string
          gang_id: string
          block: string
          density: Database['public']['Enums']['density']
          hotspot_area: string | null
          created_at: string
        }
        Insert: {
          id?: string
          gang_id: string
          block: string
          density?: Database['public']['Enums']['density']
          hotspot_area?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          gang_id?: string
          block?: string
          density?: Database['public']['Enums']['density']
          hotspot_area?: string | null
          created_at?: string
        }
      }
      gangs: {
        Row: {
          id: string
          name: string
          colors: string | null
          threat_level: Database['public']['Enums']['threat_level']
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          colors?: string | null
          threat_level?: Database['public']['Enums']['threat_level']
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          colors?: string | null
          threat_level?: Database['public']['Enums']['threat_level']
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      media: {
        Row: {
          id: string
          title: string
          type: Database['public']['Enums']['media_type']
          storage_path: string | null
          external_url: string | null
          kind: string | null
          case_id: string | null
          gang_id: string | null
          place_id: string | null
          person_id: string | null
          tags: Json | null
          uploaded_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          type: Database['public']['Enums']['media_type']
          storage_path?: string | null
          external_url?: string | null
          kind?: string | null
          case_id?: string | null
          gang_id?: string | null
          place_id?: string | null
          person_id?: string | null
          tags?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          type?: Database['public']['Enums']['media_type']
          storage_path?: string | null
          external_url?: string | null
          kind?: string | null
          case_id?: string | null
          gang_id?: string | null
          place_id?: string | null
          person_id?: string | null
          tags?: Json | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      mo_profiles: {
        Row: {
          id: string
          case_id: string
          indicators: Json
          narrative: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          indicators?: Json
          narrative?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          indicators?: Json
          narrative?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      narcotic_hotspots: {
        Row: {
          id: string
          narcotic_id: string
          area: string
          density: Database['public']['Enums']['density']
          case_id: string | null
          place_id: string | null
        }
        Insert: {
          id?: string
          narcotic_id: string
          area: string
          density?: Database['public']['Enums']['density']
          case_id?: string | null
          place_id?: string | null
        }
        Update: {
          id?: string
          narcotic_id?: string
          area?: string
          density?: Database['public']['Enums']['density']
          case_id?: string | null
          place_id?: string | null
        }
      }
      narcotic_precursors: {
        Row: {
          id: string
          narcotic_id: string
          name: string
          default_purity: number | null
          sort_order: number | null
        }
        Insert: {
          id?: string
          narcotic_id: string
          name: string
          default_purity?: number | null
          sort_order?: number | null
        }
        Update: {
          id?: string
          narcotic_id?: string
          name?: string
          default_purity?: number | null
          sort_order?: number | null
        }
      }
      narcotics: {
        Row: {
          id: string
          name: string
          classification: string | null
          icon: string | null
          popularity: number | null
          street_price: number | null
          wholesale_price: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          classification?: string | null
          icon?: string | null
          popularity?: number | null
          street_price?: number | null
          wholesale_price?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          classification?: string | null
          icon?: string | null
          popularity?: number | null
          street_price?: number | null
          wholesale_price?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          payload: Json | null
          read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          payload?: Json | null
          read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          payload?: Json | null
          read?: boolean
          created_at?: string
        }
      }
      persons: {
        Row: {
          id: string
          name: string
          alias: string | null
          dob: string | null
          gang_id: string | null
          ccw: boolean | null
          vch: number | null
          felony_count: number | null
          status: string | null
          mugshot_url: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          properties: Json
          bolo: boolean
        }
        Insert: {
          id?: string
          name: string
          alias?: string | null
          dob?: string | null
          gang_id?: string | null
          ccw?: boolean | null
          vch?: number | null
          felony_count?: number | null
          status?: string | null
          mugshot_url?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          properties?: Json
          bolo?: boolean
        }
        Update: {
          id?: string
          name?: string
          alias?: string | null
          dob?: string | null
          gang_id?: string | null
          ccw?: boolean | null
          vch?: number | null
          felony_count?: number | null
          status?: string | null
          mugshot_url?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          properties?: Json
          bolo?: boolean
        }
      }
      place_process_steps: {
        Row: {
          id: string
          place_id: string
          step_order: number | null
          description: string
        }
        Insert: {
          id?: string
          place_id: string
          step_order?: number | null
          description: string
        }
        Update: {
          id?: string
          place_id?: string
          step_order?: number | null
          description?: string
        }
      }
      places: {
        Row: {
          id: string
          name: string
          type: Database['public']['Enums']['location_type']
          area: string | null
          controlling_gang_id: string | null
          case_id: string | null
          narcotic_id: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          type: Database['public']['Enums']['location_type']
          area?: string | null
          controlling_gang_id?: string | null
          case_id?: string | null
          narcotic_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          type?: Database['public']['Enums']['location_type']
          area?: string | null
          controlling_gang_id?: string | null
          case_id?: string | null
          narcotic_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      predicate_acts: {
        Row: {
          id: string
          rico_case_id: string
          predicate_type: string
          act_date: string | null
          evidence_id: string | null
          evidence_ref: string | null
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          rico_case_id: string
          predicate_type: string
          act_date?: string | null
          evidence_id?: string | null
          evidence_ref?: string | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          rico_case_id?: string
          predicate_type?: string
          act_date?: string | null
          evidence_id?: string | null
          evidence_ref?: string | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          email: string | null
          display_name: string
          avatar_url: string | null
          badge_number: string | null
          division: Database['public']['Enums']['bureau']
          role: Database['public']['Enums']['app_role']
          active: boolean
          created_at: string
          updated_at: string
          loa: boolean
          loa_since: string | null
          discord_id: string | null
        }
        Insert: {
          id: string
          email?: string | null
          display_name?: string
          avatar_url?: string | null
          badge_number?: string | null
          division?: Database['public']['Enums']['bureau']
          role?: Database['public']['Enums']['app_role']
          active?: boolean
          created_at?: string
          updated_at?: string
          loa?: boolean
          loa_since?: string | null
          discord_id?: string | null
        }
        Update: {
          id?: string
          email?: string | null
          display_name?: string
          avatar_url?: string | null
          badge_number?: string | null
          division?: Database['public']['Enums']['bureau']
          role?: Database['public']['Enums']['app_role']
          active?: boolean
          created_at?: string
          updated_at?: string
          loa?: boolean
          loa_since?: string | null
          discord_id?: string | null
        }
      }
      raid_compensations: {
        Row: {
          id: string
          case_id: string | null
          net_value: number
          bracket_pct: number
          primary_amount: number
          support_amount: number
          ci_amount: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id?: string | null
          net_value: number
          bracket_pct: number
          primary_amount: number
          support_amount: number
          ci_amount: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string | null
          net_value?: number
          bracket_pct?: number
          primary_amount?: number
          support_amount?: number
          ci_amount?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      reports: {
        Row: {
          id: string
          case_id: string
          template: string
          kind: Database['public']['Enums']['report_kind']
          seq: number | null
          parent_id: string | null
          author_id: string | null
          fields: Json
          finalized: boolean
          signature: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          template: string
          kind?: Database['public']['Enums']['report_kind']
          seq?: number | null
          parent_id?: string | null
          author_id?: string | null
          fields?: Json
          finalized?: boolean
          signature?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          template?: string
          kind?: Database['public']['Enums']['report_kind']
          seq?: number | null
          parent_id?: string | null
          author_id?: string | null
          fields?: Json
          finalized?: boolean
          signature?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      rico_cases: {
        Row: {
          id: string
          case_id: string
          enterprise_gang_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          enterprise_gang_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          enterprise_gang_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      shift_reports: {
        Row: {
          id: string
          author_id: string
          author_name: string | null
          bureau: Database['public']['Enums']['bureau']
          week_start: string
          cases_worked: string | null
          arrests: number
          evidence_count: number
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          author_id?: string
          author_name?: string | null
          bureau: Database['public']['Enums']['bureau']
          week_start: string
          cases_worked?: string | null
          arrests?: number
          evidence_count?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          author_id?: string
          author_name?: string | null
          bureau?: Database['public']['Enums']['bureau']
          week_start?: string
          cases_worked?: string | null
          arrests?: number
          evidence_count?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      tickets: {
        Row: {
          id: string
          ticket_code: string
          source: string | null
          description: string | null
          reported_dept: string | null
          status: string | null
          routed_bureau: Database['public']['Enums']['bureau'] | null
          case_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ticket_code: string
          source?: string | null
          description?: string | null
          reported_dept?: string | null
          status?: string | null
          routed_bureau?: Database['public']['Enums']['bureau'] | null
          case_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          ticket_code?: string
          source?: string | null
          description?: string | null
          reported_dept?: string | null
          status?: string | null
          routed_bureau?: Database['public']['Enums']['bureau'] | null
          case_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      trackers: {
        Row: {
          id: string
          tracker_code: string
          target: string
          case_id: string | null
          bureau: Database['public']['Enums']['bureau']
          director_sig: string | null
          deputy_sig: string | null
          duration_hours: number
          authorized_at: string | null
          expires_at: string | null
          status: Database['public']['Enums']['tracker_status']
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tracker_code: string
          target: string
          case_id?: string | null
          bureau?: Database['public']['Enums']['bureau']
          director_sig?: string | null
          deputy_sig?: string | null
          duration_hours?: number
          authorized_at?: string | null
          expires_at?: string | null
          status?: Database['public']['Enums']['tracker_status']
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tracker_code?: string
          target?: string
          case_id?: string | null
          bureau?: Database['public']['Enums']['bureau']
          director_sig?: string | null
          deputy_sig?: string | null
          duration_hours?: number
          authorized_at?: string | null
          expires_at?: string | null
          status?: Database['public']['Enums']['tracker_status']
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      vehicles: {
        Row: {
          id: string
          plate: string
          model: string | null
          color: string | null
          owner_id: string | null
          gang_id: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          plate: string
          model?: string | null
          color?: string | null
          owner_id?: string | null
          gang_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          plate?: string
          model?: string | null
          color?: string | null
          owner_id?: string | null
          gang_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      assign_member: { Args: { target: string; new_role: Database['public']['Enums']['app_role']; new_division: Database['public']['Enums']['bureau'] | null; set_active: boolean }; Returns: undefined }
      mo_crossref: { Args: { terms: string[] }; Returns: Json }
      report_finalize: { Args: { p_report: string; p_badge: string }; Returns: undefined }
      signoff_submit: { Args: { p_case: string }; Returns: undefined }
      signoff_decide: { Args: { p_case: string; p_decision: string; p_note: string }; Returns: undefined }
      signoff_owner_action: { Args: { p_case: string; p_action: string }; Returns: undefined }
    }
    Enums: {
      app_role: 'detective' | 'supervisor' | 'director' | 'command' | 'senior_detective' | 'bureau_lead' | 'deputy_director'
      assign_role: 'primary' | 'support'
      bench_type: 'street' | 'organized'
      bureau: 'LSB' | 'BCB' | 'SAB' | 'JTF'
      case_status: 'open' | 'active' | 'cold' | 'closed'
      density: 'low' | 'medium' | 'high'
      doc_kind: 'doc' | 'sheet' | 'pdf' | 'zip'
      evidence_tamper: 'intact' | 'compromised' | 'released' | 'destroyed'
      location_type: 'drug_lab' | 'stash_house' | 'dead_drop' | 'front_business' | 'chop_shop'
      media_type: 'image' | 'video' | 'fivemanage' | 'document'
      report_kind: 'initial' | 'supplemental' | 'followup'
      threat_level: 'low' | 'medium' | 'high'
      tracker_status: 'pending' | 'authorized' | 'expired'
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
