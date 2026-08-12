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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          changes: Json
          created_at: string
          id: string
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          event_id: string | null
          goal_amount: number | null
          id: string
          name: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_id?: string | null
          goal_amount?: number | null
          id?: string
          name: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_id?: string | null
          goal_amount?: number | null
          id?: string
          name?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      donations: {
        Row: {
          amount: number
          campaign: string | null
          campaign_id: string | null
          created_at: string
          date: string
          deleted_at: string | null
          grant_id: string | null
          id: string
          import_batch_id: string | null
          method: string | null
          notes: string | null
          person_id: string
          source: string | null
        }
        Insert: {
          amount: number
          campaign?: string | null
          campaign_id?: string | null
          created_at?: string
          date?: string
          deleted_at?: string | null
          grant_id?: string | null
          id?: string
          import_batch_id?: string | null
          method?: string | null
          notes?: string | null
          person_id: string
          source?: string | null
        }
        Update: {
          amount?: number
          campaign?: string | null
          campaign_id?: string | null
          created_at?: string
          date?: string
          deleted_at?: string | null
          grant_id?: string | null
          id?: string
          import_batch_id?: string | null
          method?: string | null
          notes?: string | null
          person_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "donations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number | null
          created_at: string
          date: string
          deleted_at: string | null
          description: string | null
          id: string
          location: string | null
          name: string
          program: string | null
          staff_lead: string | null
          time: string | null
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          date: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          location?: string | null
          name: string
          program?: string | null
          staff_lead?: string | null
          time?: string | null
        }
        Update: {
          capacity?: number | null
          created_at?: string
          date?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          location?: string | null
          name?: string
          program?: string | null
          staff_lead?: string | null
          time?: string | null
        }
        Relationships: []
      }
      field_sources: {
        Row: {
          created_at: string
          field_name: string
          id: string
          import_batch_id: string | null
          person_id: string
          recorded_date: string
          source: string
        }
        Insert: {
          created_at?: string
          field_name: string
          id?: string
          import_batch_id?: string | null
          person_id: string
          recorded_date?: string
          source: string
        }
        Update: {
          created_at?: string
          field_name?: string
          id?: string
          import_batch_id?: string | null
          person_id?: string
          recorded_date?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_sources_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_sources_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      grants: {
        Row: {
          amount_awarded: number | null
          amount_requested: number | null
          application_deadline: string | null
          campaign_id: string | null
          created_at: string
          funder_id: string
          id: string
          name: string
          notes: string | null
          program_officer_id: string | null
          renewal_deadline: string | null
          report_deadline: string | null
          restricted_program: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          amount_awarded?: number | null
          amount_requested?: number | null
          application_deadline?: string | null
          campaign_id?: string | null
          created_at?: string
          funder_id: string
          id?: string
          name: string
          notes?: string | null
          program_officer_id?: string | null
          renewal_deadline?: string | null
          report_deadline?: string | null
          restricted_program?: string | null
          stage?: string
          updated_at?: string
        }
        Update: {
          amount_awarded?: number | null
          amount_requested?: number | null
          application_deadline?: string | null
          campaign_id?: string | null
          created_at?: string
          funder_id?: string
          id?: string
          name?: string
          notes?: string | null
          program_officer_id?: string | null
          renewal_deadline?: string | null
          report_deadline?: string | null
          restricted_program?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grants_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grants_funder_id_fkey"
            columns: ["funder_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grants_program_officer_id_fkey"
            columns: ["program_officer_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          address: string | null
          billing_address: string | null
          created_at: string
          id: string
          import_batch_id: string | null
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          billing_address?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          billing_address?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "households_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          ambiguous_rows: number
          created_at: string
          filename: string
          id: string
          import_date: string
          mapping: Json
          matched_rows: number
          new_rows: number
          status: string
          total_rows: number
          uploaded_by: string | null
        }
        Insert: {
          ambiguous_rows?: number
          created_at?: string
          filename: string
          id?: string
          import_date?: string
          mapping?: Json
          matched_rows?: number
          new_rows?: number
          status?: string
          total_rows?: number
          uploaded_by?: string | null
        }
        Update: {
          ambiguous_rows?: number
          created_at?: string
          filename?: string
          id?: string
          import_date?: string
          mapping?: Json
          matched_rows?: number
          new_rows?: number
          status?: string
          total_rows?: number
          uploaded_by?: string | null
        }
        Relationships: []
      }
      integrations: {
        Row: {
          created_at: string
          id: string
          last_sync_at: string | null
          name: string
          notes: string | null
          purpose: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_sync_at?: string | null
          name: string
          notes?: string | null
          purpose?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_sync_at?: string | null
          name?: string
          notes?: string | null
          purpose?: string | null
          status?: string
        }
        Relationships: []
      }
      interactions: {
        Row: {
          author: string | null
          created_at: string
          date: string
          id: string
          import_batch_id: string | null
          person_id: string
          text: string | null
          type: string
        }
        Insert: {
          author?: string | null
          created_at?: string
          date?: string
          id?: string
          import_batch_id?: string | null
          person_id: string
          text?: string | null
          type: string
        }
        Update: {
          author?: string | null
          created_at?: string
          date?: string
          id?: string
          import_batch_id?: string | null
          person_id?: string
          text?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      merge_log: {
        Row: {
          created_at: string
          id: string
          merged_person_id: string
          merged_snapshot: Json
          moved_counts: Json
          performed_by: string | null
          performed_by_email: string | null
          surviving_person_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          merged_person_id: string
          merged_snapshot?: Json
          moved_counts?: Json
          performed_by?: string | null
          performed_by_email?: string | null
          surviving_person_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          merged_person_id?: string
          merged_snapshot?: Json
          moved_counts?: Json
          performed_by?: string | null
          performed_by_email?: string | null
          surviving_person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merge_log_surviving_person_id_fkey"
            columns: ["surviving_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      met_source_options: {
        Row: {
          created_at: string
          id: string
          label: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          birth_date: string | null
          contact_type: string
          created_at: string
          deleted_at: string | null
          display_name: string | null
          email: string | null
          first_name: string | null
          household_id: string | null
          id: string
          import_batch_id: string | null
          last_activity_date: string | null
          last_gift_amount: number | null
          last_gift_date: string | null
          last_name: string | null
          lifetime_giving: number
          met_date: string | null
          met_source: string | null
          notes: string | null
          owner: string | null
          parent_org_id: string | null
          phone: string | null
          programs: string[]
          role: string
          school: string | null
          tags: string[]
          this_year_giving: number
        }
        Insert: {
          birth_date?: string | null
          contact_type?: string
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          household_id?: string | null
          id?: string
          import_batch_id?: string | null
          last_activity_date?: string | null
          last_gift_amount?: number | null
          last_gift_date?: string | null
          last_name?: string | null
          lifetime_giving?: number
          met_date?: string | null
          met_source?: string | null
          notes?: string | null
          owner?: string | null
          parent_org_id?: string | null
          phone?: string | null
          programs?: string[]
          role?: string
          school?: string | null
          tags?: string[]
          this_year_giving?: number
        }
        Update: {
          birth_date?: string | null
          contact_type?: string
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          household_id?: string | null
          id?: string
          import_batch_id?: string | null
          last_activity_date?: string | null
          last_gift_amount?: number | null
          last_gift_date?: string | null
          last_name?: string | null
          lifetime_giving?: number
          met_date?: string | null
          met_source?: string | null
          notes?: string | null
          owner?: string | null
          parent_org_id?: string | null
          phone?: string | null
          programs?: string[]
          role?: string
          school?: string | null
          tags?: string[]
          this_year_giving?: number
        }
        Relationships: [
          {
            foreignKeyName: "people_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      program_options: {
        Row: {
          created_at: string
          id: string
          label: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      registrations: {
        Row: {
          created_at: string
          event_id: string
          id: string
          person_id: string
          status: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          person_id: string
          status?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          person_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      review_queue: {
        Row: {
          batch_id: string | null
          candidate_person_ids: string[]
          created_at: string
          filename: string | null
          id: string
          reason: string
          resolution_note: string | null
          row_data: Json
          status: string
        }
        Insert: {
          batch_id?: string | null
          candidate_person_ids?: string[]
          created_at?: string
          filename?: string | null
          id?: string
          reason: string
          resolution_note?: string | null
          row_data?: Json
          status?: string
        }
        Update: {
          batch_id?: string | null
          candidate_person_ids?: string[]
          created_at?: string
          filename?: string | null
          id?: string
          reason?: string
          resolution_note?: string | null
          row_data?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_queue_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          name: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      tag_options: {
        Row: {
          category: string
          created_at: string
          id: string
          label: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_at: string | null
          completion_note: string | null
          created_at: string
          deleted_at: string | null
          due_date: string | null
          grant_id: string | null
          id: string
          notes: string | null
          owner: string | null
          person_id: string | null
          priority: string | null
          status: string
          text: string
        }
        Insert: {
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          grant_id?: string | null
          id?: string
          notes?: string | null
          owner?: string | null
          person_id?: string | null
          priority?: string | null
          status?: string
          text: string
        }
        Update: {
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          grant_id?: string | null
          id?: string
          notes?: string | null
          owner?: string | null
          person_id?: string | null
          priority?: string | null
          status?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
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
      yahrzeits: {
        Row: {
          created_at: string
          deceased_name: string
          hebrew_day: number
          hebrew_month: number
          id: string
          person_id: string
          relationship: string | null
        }
        Insert: {
          created_at?: string
          deceased_name: string
          hebrew_day: number
          hebrew_month: number
          id?: string
          person_id: string
          relationship?: string | null
        }
        Update: {
          created_at?: string
          deceased_name?: string
          hebrew_day?: number
          hebrew_month?: number
          id?: string
          person_id?: string
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "yahrzeits_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      merge_people: {
        Args: {
          _field_values?: Json
          _merged_id: string
          _surviving_id: string
        }
        Returns: string
      }
      recalc_person_totals: { Args: { _person_id: string }; Returns: undefined }
      recalculate_all_giving_totals: { Args: never; Returns: number }
      undo_import: { Args: { _batch_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "marketing" | "va"
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
      app_role: ["admin", "marketing", "va"],
    },
  },
} as const
