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
      donations: {
        Row: {
          amount: number
          campaign: string | null
          created_at: string
          date: string
          id: string
          method: string | null
          notes: string | null
          person_id: string
          source: string | null
        }
        Insert: {
          amount: number
          campaign?: string | null
          created_at?: string
          date?: string
          id?: string
          method?: string | null
          notes?: string | null
          person_id: string
          source?: string | null
        }
        Update: {
          amount?: number
          campaign?: string | null
          created_at?: string
          date?: string
          id?: string
          method?: string | null
          notes?: string | null
          person_id?: string
          source?: string | null
        }
        Relationships: [
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
          person_id: string
          recorded_date: string
          source: string
        }
        Insert: {
          created_at?: string
          field_name: string
          id?: string
          person_id: string
          recorded_date?: string
          source: string
        }
        Update: {
          created_at?: string
          field_name?: string
          id?: string
          person_id?: string
          recorded_date?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_sources_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      interactions: {
        Row: {
          author: string | null
          created_at: string
          date: string
          id: string
          person_id: string
          text: string | null
          type: string
        }
        Insert: {
          author?: string | null
          created_at?: string
          date?: string
          id?: string
          person_id: string
          text?: string | null
          type: string
        }
        Update: {
          author?: string | null
          created_at?: string
          date?: string
          id?: string
          person_id?: string
          text?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_person_id_fkey"
            columns: ["person_id"]
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
          created_at: string
          email: string | null
          first_name: string
          household_id: string | null
          id: string
          last_activity_date: string | null
          last_gift_amount: number | null
          last_gift_date: string | null
          last_name: string
          lifetime_giving: number
          met_date: string | null
          met_source: string | null
          owner: string | null
          phone: string | null
          programs: string[]
          role: string
          tags: string[]
          this_year_giving: number
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          household_id?: string | null
          id?: string
          last_activity_date?: string | null
          last_gift_amount?: number | null
          last_gift_date?: string | null
          last_name: string
          lifetime_giving?: number
          met_date?: string | null
          met_source?: string | null
          owner?: string | null
          phone?: string | null
          programs?: string[]
          role?: string
          tags?: string[]
          this_year_giving?: number
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          household_id?: string | null
          id?: string
          last_activity_date?: string | null
          last_gift_amount?: number | null
          last_gift_date?: string | null
          last_name?: string
          lifetime_giving?: number
          met_date?: string | null
          met_source?: string | null
          owner?: string | null
          phone?: string | null
          programs?: string[]
          role?: string
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
        ]
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
      tasks: {
        Row: {
          completion_note: string | null
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          owner: string | null
          person_id: string | null
          priority: string | null
          status: string
          text: string
        }
        Insert: {
          completion_note?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          owner?: string | null
          person_id?: string | null
          priority?: string | null
          status?: string
          text: string
        }
        Update: {
          completion_note?: string | null
          created_at?: string
          due_date?: string | null
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
            foreignKeyName: "tasks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
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
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
