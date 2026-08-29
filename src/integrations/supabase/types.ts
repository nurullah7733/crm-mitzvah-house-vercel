export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      activity_options: {
        Row: {
          created_at: string;
          id: string;
          label: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
        };
        Relationships: [];
      };
      app_error_log: {
        Row: {
          action: string | null;
          area: string | null;
          created_at: string;
          detail: string | null;
          id: string;
          level: string;
          message: string;
          occurred_at: string;
          path: string | null;
          user_agent: string | null;
          user_email: string | null;
          user_id: string | null;
        };
        Insert: {
          action?: string | null;
          area?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          level?: string;
          message: string;
          occurred_at?: string;
          path?: string | null;
          user_agent?: string | null;
          user_email?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string | null;
          area?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          level?: string;
          message?: string;
          occurred_at?: string;
          path?: string | null;
          user_agent?: string | null;
          user_email?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value?: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          changes: Json;
          created_at: string;
          id: string;
          record_id: string | null;
          table_name: string;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          changes?: Json;
          created_at?: string;
          id?: string;
          record_id?: string | null;
          table_name: string;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          changes?: Json;
          created_at?: string;
          id?: string;
          record_id?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
      campaigns: {
        Row: {
          created_at: string;
          description: string | null;
          end_date: string | null;
          event_id: string | null;
          goal_amount: number | null;
          id: string;
          name: string;
          start_date: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          end_date?: string | null;
          event_id?: string | null;
          goal_amount?: number | null;
          id?: string;
          name: string;
          start_date?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          end_date?: string | null;
          event_id?: string | null;
          goal_amount?: number | null;
          id?: string;
          name?: string;
          start_date?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_methods: {
        Row: {
          created_at: string;
          id: string;
          import_batch_id: string | null;
          is_primary: boolean;
          kind: string;
          label: string | null;
          method_type: string;
          person_id: string;
          updated_at: string;
          value: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          import_batch_id?: string | null;
          is_primary?: boolean;
          kind?: string;
          label?: string | null;
          method_type?: string;
          person_id: string;
          updated_at?: string;
          value: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          import_batch_id?: string | null;
          is_primary?: boolean;
          kind?: string;
          label?: string | null;
          method_type?: string;
          person_id?: string;
          updated_at?: string;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_methods_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_methods_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      donations: {
        Row: {
          amount: number;
          campaign_id: string | null;
          created_at: string;
          date: string;
          deleted_at: string | null;
          event_id: string | null;
          external_transaction_id: string | null;
          external_transaction_id_key: string | null;
          goods_or_services_description: string | null;
          goods_or_services_provided: boolean;
          grant_id: string | null;
          id: string;
          import_batch_id: string | null;
          import_fingerprint: string | null;
          method: string | null;
          notes: string | null;
          person_id: string;
          pledge_id: string | null;
          receipt_sent: boolean;
          receipt_sent_date: string | null;
          source: string | null;
          transaction_object_type: string | null;
          transaction_source_system: string | null;
          thank_you_sent: boolean;
          thank_you_sent_date: string | null;
        };
        Insert: {
          amount: number;
          campaign_id?: string | null;
          created_at?: string;
          date?: string;
          deleted_at?: string | null;
          event_id?: string | null;
          external_transaction_id?: string | null;
          external_transaction_id_key?: string | null;
          goods_or_services_description?: string | null;
          goods_or_services_provided?: boolean;
          grant_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          import_fingerprint?: string | null;
          method?: string | null;
          notes?: string | null;
          person_id: string;
          pledge_id?: string | null;
          receipt_sent?: boolean;
          receipt_sent_date?: string | null;
          source?: string | null;
          transaction_object_type?: string | null;
          transaction_source_system?: string | null;
          thank_you_sent?: boolean;
          thank_you_sent_date?: string | null;
        };
        Update: {
          amount?: number;
          campaign_id?: string | null;
          created_at?: string;
          date?: string;
          deleted_at?: string | null;
          event_id?: string | null;
          external_transaction_id?: string | null;
          external_transaction_id_key?: string | null;
          goods_or_services_description?: string | null;
          goods_or_services_provided?: boolean;
          grant_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          import_fingerprint?: string | null;
          method?: string | null;
          notes?: string | null;
          person_id?: string;
          pledge_id?: string | null;
          receipt_sent?: boolean;
          receipt_sent_date?: string | null;
          source?: string | null;
          transaction_object_type?: string | null;
          transaction_source_system?: string | null;
          thank_you_sent?: boolean;
          thank_you_sent_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "donations_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "donations_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "donations_grant_id_fkey";
            columns: ["grant_id"];
            isOneToOne: false;
            referencedRelation: "grants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "donations_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "donations_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "donations_pledge_id_fkey";
            columns: ["pledge_id"];
            isOneToOne: false;
            referencedRelation: "pledges";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          capacity: number | null;
          created_at: string;
          date: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          location: string | null;
          name: string;
          program: string | null;
          registration_fee: number | null;
          staff_lead: string | null;
          time: string | null;
        };
        Insert: {
          capacity?: number | null;
          created_at?: string;
          date: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          location?: string | null;
          name: string;
          program?: string | null;
          registration_fee?: number | null;
          staff_lead?: string | null;
          time?: string | null;
        };
        Update: {
          capacity?: number | null;
          created_at?: string;
          date?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          location?: string | null;
          name?: string;
          program?: string | null;
          registration_fee?: number | null;
          staff_lead?: string | null;
          time?: string | null;
        };
        Relationships: [];
      };
      field_sources: {
        Row: {
          created_at: string;
          field_name: string;
          id: string;
          import_batch_id: string | null;
          person_id: string;
          recorded_date: string;
          source: string;
        };
        Insert: {
          created_at?: string;
          field_name: string;
          id?: string;
          import_batch_id?: string | null;
          person_id: string;
          recorded_date?: string;
          source: string;
        };
        Update: {
          created_at?: string;
          field_name?: string;
          id?: string;
          import_batch_id?: string | null;
          person_id?: string;
          recorded_date?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "field_sources_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "field_sources_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      grants: {
        Row: {
          amount_awarded: number | null;
          amount_requested: number | null;
          application_deadline: string | null;
          campaign_id: string | null;
          created_at: string;
          funder_id: string;
          id: string;
          name: string;
          notes: string | null;
          program_officer_id: string | null;
          renewal_deadline: string | null;
          report_deadline: string | null;
          restricted_program: string | null;
          stage: string;
          updated_at: string;
        };
        Insert: {
          amount_awarded?: number | null;
          amount_requested?: number | null;
          application_deadline?: string | null;
          campaign_id?: string | null;
          created_at?: string;
          funder_id: string;
          id?: string;
          name: string;
          notes?: string | null;
          program_officer_id?: string | null;
          renewal_deadline?: string | null;
          report_deadline?: string | null;
          restricted_program?: string | null;
          stage?: string;
          updated_at?: string;
        };
        Update: {
          amount_awarded?: number | null;
          amount_requested?: number | null;
          application_deadline?: string | null;
          campaign_id?: string | null;
          created_at?: string;
          funder_id?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          program_officer_id?: string | null;
          renewal_deadline?: string | null;
          report_deadline?: string | null;
          restricted_program?: string | null;
          stage?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "grants_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grants_funder_id_fkey";
            columns: ["funder_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grants_program_officer_id_fkey";
            columns: ["program_officer_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      households: {
        Row: {
          address: string | null;
          address_line2: string | null;
          address_line3: string | null;
          billing_address: string | null;
          city: string | null;
          county: string | null;
          created_at: string;
          id: string;
          import_batch_id: string | null;
          name: string;
          notes: string | null;
          phone: string | null;
          postal_code: string | null;
          state: string | null;
          status: string;
        };
        Insert: {
          address?: string | null;
          address_line2?: string | null;
          address_line3?: string | null;
          billing_address?: string | null;
          city?: string | null;
          county?: string | null;
          created_at?: string;
          id?: string;
          import_batch_id?: string | null;
          name: string;
          notes?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          state?: string | null;
          status?: string;
        };
        Update: {
          address?: string | null;
          address_line2?: string | null;
          address_line3?: string | null;
          billing_address?: string | null;
          city?: string | null;
          county?: string | null;
          created_at?: string;
          id?: string;
          import_batch_id?: string | null;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          state?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "households_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      import_batches: {
        Row: {
          ambiguous_rows: number;
          completed_at: string | null;
          created_at: string;
          created_rows: number;
          failed_rows: number;
          filename: string;
          flagged_rows: number;
          header_mode: string | null;
          header_row_number: number | null;
          id: string;
          import_date: string;
          mapping: Json;
          matched_rows: number;
          new_rows: number;
          processed_rows: number;
          raw_file_hash: string | null;
          selected_sheet_index: number | null;
          selected_sheet_name: string | null;
          source_data_hash: string | null;
          source_system: string | null;
          source_system_confidence: string;
          source_structure: Json | null;
          status: string;
          total_rows: number;
          transaction_object_type: string | null;
          uploaded_by: string | null;
        };
        Insert: {
          ambiguous_rows?: number;
          completed_at?: string | null;
          created_at?: string;
          created_rows?: number;
          failed_rows?: number;
          filename: string;
          flagged_rows?: number;
          header_mode?: string | null;
          header_row_number?: number | null;
          id?: string;
          import_date?: string;
          mapping?: Json;
          matched_rows?: number;
          new_rows?: number;
          processed_rows?: number;
          raw_file_hash?: string | null;
          selected_sheet_index?: number | null;
          selected_sheet_name?: string | null;
          source_data_hash?: string | null;
          source_system?: string | null;
          source_system_confidence?: string;
          source_structure?: Json | null;
          status?: string;
          total_rows?: number;
          transaction_object_type?: string | null;
          uploaded_by?: string | null;
        };
        Update: {
          ambiguous_rows?: number;
          completed_at?: string | null;
          created_at?: string;
          created_rows?: number;
          failed_rows?: number;
          filename?: string;
          flagged_rows?: number;
          header_mode?: string | null;
          header_row_number?: number | null;
          id?: string;
          import_date?: string;
          mapping?: Json;
          matched_rows?: number;
          new_rows?: number;
          processed_rows?: number;
          raw_file_hash?: string | null;
          selected_sheet_index?: number | null;
          selected_sheet_name?: string | null;
          source_data_hash?: string | null;
          source_system?: string | null;
          source_system_confidence?: string;
          source_structure?: Json | null;
          status?: string;
          total_rows?: number;
          transaction_object_type?: string | null;
          uploaded_by?: string | null;
        };
        Relationships: [];
      };
      import_staged_rows: {
        Row: {
          batch_id: string;
          created_at: string;
          id: string;
          mapping: Json;
          normalized_values: Json;
          physical_row_number: number;
          raw_cells: Json;
          source_columns: Json;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          id?: string;
          mapping: Json;
          normalized_values?: Json;
          physical_row_number: number;
          raw_cells: Json;
          source_columns: Json;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          id?: string;
          mapping?: Json;
          normalized_values?: Json;
          physical_row_number?: number;
          raw_cells?: Json;
          source_columns?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "import_staged_rows_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      import_row_outcomes: {
        Row: {
          batch_id: string;
          created_at: string;
          id: string;
          message: string | null;
          outcome: string;
          person_id: string | null;
          review_queue_id: string | null;
          row_data: Json;
          row_number: number;
          updated_at: string;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          id?: string;
          message?: string | null;
          outcome?: string;
          person_id?: string | null;
          review_queue_id?: string | null;
          row_data?: Json;
          row_number: number;
          updated_at?: string;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          id?: string;
          message?: string | null;
          outcome?: string;
          person_id?: string | null;
          review_queue_id?: string | null;
          row_data?: Json;
          row_number?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_row_outcomes_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_row_outcomes_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_row_outcomes_review_queue_id_fkey";
            columns: ["review_queue_id"];
            isOneToOne: false;
            referencedRelation: "review_queue";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_credentials: {
        Row: {
          created_at: string;
          credential_keys: string[];
          id: string;
          masked_hint: string | null;
          provider: string;
          updated_at: string;
          vault_secret_id: string | null;
        };
        Insert: {
          created_at?: string;
          credential_keys?: string[];
          id?: string;
          masked_hint?: string | null;
          provider: string;
          updated_at?: string;
          vault_secret_id?: string | null;
        };
        Update: {
          created_at?: string;
          credential_keys?: string[];
          id?: string;
          masked_hint?: string | null;
          provider?: string;
          updated_at?: string;
          vault_secret_id?: string | null;
        };
        Relationships: [];
      };
      integration_events: {
        Row: {
          actor_email: string | null;
          created_at: string;
          id: string;
          kind: string;
          message: string | null;
          ok: boolean;
          provider: string;
        };
        Insert: {
          actor_email?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          message?: string | null;
          ok?: boolean;
          provider: string;
        };
        Update: {
          actor_email?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          message?: string | null;
          ok?: boolean;
          provider?: string;
        };
        Relationships: [];
      };
      integrations: {
        Row: {
          created_at: string;
          id: string;
          last_sync_at: string | null;
          name: string;
          notes: string | null;
          purpose: string | null;
          status: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_sync_at?: string | null;
          name: string;
          notes?: string | null;
          purpose?: string | null;
          status?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_sync_at?: string | null;
          name?: string;
          notes?: string | null;
          purpose?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      interactions: {
        Row: {
          author: string | null;
          created_at: string;
          date: string;
          household_id: string | null;
          id: string;
          import_batch_id: string | null;
          person_id: string | null;
          source_id: string | null;
          source_kind: string | null;
          text: string | null;
          type: string;
        };
        Insert: {
          author?: string | null;
          created_at?: string;
          date?: string;
          household_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          person_id?: string | null;
          source_id?: string | null;
          source_kind?: string | null;
          text?: string | null;
          type: string;
        };
        Update: {
          author?: string | null;
          created_at?: string;
          date?: string;
          household_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          person_id?: string | null;
          source_id?: string | null;
          source_kind?: string | null;
          text?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interactions_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interactions_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interactions_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      issued_documents: {
        Row: {
          created_at: string;
          delivered_at: string | null;
          delivery_method: string;
          delivery_note: string | null;
          delivery_status: string;
          donation_id: string | null;
          gift_count: number;
          gift_ids: string[];
          id: string;
          issued_at: string;
          issued_by: string | null;
          issued_by_email: string | null;
          kind: string;
          person_id: string;
          snapshot: Json;
          status: string;
          tax_year: number | null;
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          delivered_at?: string | null;
          delivery_method?: string;
          delivery_note?: string | null;
          delivery_status?: string;
          donation_id?: string | null;
          gift_count?: number;
          gift_ids?: string[];
          id?: string;
          issued_at?: string;
          issued_by?: string | null;
          issued_by_email?: string | null;
          kind: string;
          person_id: string;
          snapshot?: Json;
          status?: string;
          tax_year?: number | null;
          total_amount?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          delivered_at?: string | null;
          delivery_method?: string;
          delivery_note?: string | null;
          delivery_status?: string;
          donation_id?: string | null;
          gift_count?: number;
          gift_ids?: string[];
          id?: string;
          issued_at?: string;
          issued_by?: string | null;
          issued_by_email?: string | null;
          kind?: string;
          person_id?: string;
          snapshot?: Json;
          status?: string;
          tax_year?: number | null;
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "issued_documents_donation_id_fkey";
            columns: ["donation_id"];
            isOneToOne: false;
            referencedRelation: "donations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issued_documents_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      merge_log: {
        Row: {
          created_at: string;
          id: string;
          merged_person_id: string;
          merged_snapshot: Json;
          moved_counts: Json;
          performed_by: string | null;
          performed_by_email: string | null;
          surviving_person_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          merged_person_id: string;
          merged_snapshot?: Json;
          moved_counts?: Json;
          performed_by?: string | null;
          performed_by_email?: string | null;
          surviving_person_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          merged_person_id?: string;
          merged_snapshot?: Json;
          moved_counts?: Json;
          performed_by?: string | null;
          performed_by_email?: string | null;
          surviving_person_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "merge_log_surviving_person_id_fkey";
            columns: ["surviving_person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      met_source_options: {
        Row: {
          created_at: string;
          id: string;
          label: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
        };
        Relationships: [];
      };
      people: {
        Row: {
          anniversary_date: string | null;
          birth_date: string | null;
          contact_type: string;
          created_at: string;
          deleted_at: string | null;
          display_name: string | null;
          email: string | null;
          first_name: string | null;
          gender: string | null;
          household_id: string | null;
          household_relationship: string | null;
          id: string;
          import_batch_id: string | null;
          last_activity_date: string | null;
          last_gift_amount: number | null;
          last_gift_date: string | null;
          last_name: string | null;
          lifetime_giving: number;
          mailing_preference: string | null;
          met_date: string | null;
          met_source: string | null;
          notes: string | null;
          owner: string | null;
          parent_org_id: string | null;
          phone: string | null;
          programs: string[];
          role: string;
          school: string | null;
          tags: string[];
          this_year_giving: number;
        };
        Insert: {
          anniversary_date?: string | null;
          birth_date?: string | null;
          contact_type?: string;
          created_at?: string;
          deleted_at?: string | null;
          display_name?: string | null;
          email?: string | null;
          first_name?: string | null;
          gender?: string | null;
          household_id?: string | null;
          household_relationship?: string | null;
          id?: string;
          import_batch_id?: string | null;
          last_activity_date?: string | null;
          last_gift_amount?: number | null;
          last_gift_date?: string | null;
          last_name?: string | null;
          lifetime_giving?: number;
          mailing_preference?: string | null;
          met_date?: string | null;
          met_source?: string | null;
          notes?: string | null;
          owner?: string | null;
          parent_org_id?: string | null;
          phone?: string | null;
          programs?: string[];
          role?: string;
          school?: string | null;
          tags?: string[];
          this_year_giving?: number;
        };
        Update: {
          anniversary_date?: string | null;
          birth_date?: string | null;
          contact_type?: string;
          created_at?: string;
          deleted_at?: string | null;
          display_name?: string | null;
          email?: string | null;
          first_name?: string | null;
          gender?: string | null;
          household_id?: string | null;
          household_relationship?: string | null;
          id?: string;
          import_batch_id?: string | null;
          last_activity_date?: string | null;
          last_gift_amount?: number | null;
          last_gift_date?: string | null;
          last_name?: string | null;
          lifetime_giving?: number;
          mailing_preference?: string | null;
          met_date?: string | null;
          met_source?: string | null;
          notes?: string | null;
          owner?: string | null;
          parent_org_id?: string | null;
          phone?: string | null;
          programs?: string[];
          role?: string;
          school?: string | null;
          tags?: string[];
          this_year_giving?: number;
        };
        Relationships: [
          {
            foreignKeyName: "people_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "people_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "people_parent_org_id_fkey";
            columns: ["parent_org_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      pledges: {
        Row: {
          amount: number;
          campaign_id: string | null;
          created_at: string;
          end_date: string | null;
          external_ref: string | null;
          frequency: string;
          grace_days: number;
          id: string;
          import_batch_id: string | null;
          notes: string | null;
          person_id: string;
          start_date: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          campaign_id?: string | null;
          created_at?: string;
          end_date?: string | null;
          external_ref?: string | null;
          frequency?: string;
          grace_days?: number;
          id?: string;
          import_batch_id?: string | null;
          notes?: string | null;
          person_id: string;
          start_date?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          campaign_id?: string | null;
          created_at?: string;
          end_date?: string | null;
          external_ref?: string | null;
          frequency?: string;
          grace_days?: number;
          id?: string;
          import_batch_id?: string | null;
          notes?: string | null;
          person_id?: string;
          start_date?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pledges_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pledges_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pledges_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      program_options: {
        Row: {
          created_at: string;
          id: string;
          label: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
        };
        Relationships: [];
      };
      registrations: {
        Row: {
          created_at: string;
          event_id: string;
          fee_amount: number;
          id: string;
          import_batch_id: string | null;
          payment_amount: number | null;
          person_id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          fee_amount?: number;
          id?: string;
          import_batch_id?: string | null;
          payment_amount?: number | null;
          person_id: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          fee_amount?: number;
          id?: string;
          import_batch_id?: string | null;
          payment_amount?: number | null;
          person_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "registrations_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "registrations_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "registrations_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      review_queue: {
        Row: {
          batch_id: string | null;
          candidate_person_ids: string[];
          created_at: string;
          filename: string | null;
          id: string;
          reason: string;
          resolution_note: string | null;
          row_data: Json;
          status: string;
        };
        Insert: {
          batch_id?: string | null;
          candidate_person_ids?: string[];
          created_at?: string;
          filename?: string | null;
          id?: string;
          reason: string;
          resolution_note?: string | null;
          row_data?: Json;
          status?: string;
        };
        Update: {
          batch_id?: string | null;
          candidate_person_ids?: string[];
          created_at?: string;
          filename?: string | null;
          id?: string;
          reason?: string;
          resolution_note?: string | null;
          row_data?: Json;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_queue_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_members: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          id: string;
          name: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          id?: string;
          name: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string | null;
        };
        Relationships: [];
      };
      tag_options: {
        Row: {
          category: string;
          created_at: string;
          id: string;
          label: string;
        };
        Insert: {
          category?: string;
          created_at?: string;
          id?: string;
          label: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          id?: string;
          label?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          completed_at: string | null;
          completion_note: string | null;
          created_at: string;
          deleted_at: string | null;
          donation_id: string | null;
          due_date: string | null;
          grant_id: string | null;
          id: string;
          import_batch_id: string | null;
          notes: string | null;
          owner: string | null;
          person_id: string | null;
          priority: string | null;
          status: string;
          text: string;
        };
        Insert: {
          completed_at?: string | null;
          completion_note?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          donation_id?: string | null;
          due_date?: string | null;
          grant_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          notes?: string | null;
          owner?: string | null;
          person_id?: string | null;
          priority?: string | null;
          status?: string;
          text: string;
        };
        Update: {
          completed_at?: string | null;
          completion_note?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          donation_id?: string | null;
          due_date?: string | null;
          grant_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          notes?: string | null;
          owner?: string | null;
          person_id?: string | null;
          priority?: string | null;
          status?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_donation_id_fkey";
            columns: ["donation_id"];
            isOneToOne: false;
            referencedRelation: "donations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_grant_id_fkey";
            columns: ["grant_id"];
            isOneToOne: false;
            referencedRelation: "grants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      yahrzeits: {
        Row: {
          created_at: string;
          death_after_sunset: boolean;
          death_date: string | null;
          deceased_name: string;
          hebrew_day: number;
          hebrew_month: number;
          id: string;
          needs_sunset_review: boolean;
          person_id: string;
          relationship: string | null;
        };
        Insert: {
          created_at?: string;
          death_after_sunset?: boolean;
          death_date?: string | null;
          deceased_name: string;
          hebrew_day: number;
          hebrew_month: number;
          id?: string;
          needs_sunset_review?: boolean;
          person_id: string;
          relationship?: string | null;
        };
        Update: {
          created_at?: string;
          death_after_sunset?: boolean;
          death_date?: string | null;
          deceased_name?: string;
          hebrew_day?: number;
          hebrew_month?: number;
          id?: string;
          needs_sunset_review?: boolean;
          person_id?: string;
          relationship?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "yahrzeits_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_import_activity_core: {
        Args: {
          _batch_id?: string | null;
          _donation?: Json | null;
          _note?: Json | null;
          _person_id: string;
          _registrations?: Json;
        };
        Returns: Json;
      };
      archive_records: {
        Args: { _ids: string[]; _table: string };
        Returns: number;
      };
      cleanup_app_error_log: { Args: never; Returns: number };
      daitch_mokotoff: { Args: { "": string }; Returns: string[] };
      delete_integration_credentials: {
        Args: { _provider: string };
        Returns: undefined;
      };
      dmetaphone: { Args: { "": string }; Returns: string };
      dmetaphone_alt: { Args: { "": string }; Returns: string };
      find_duplicate_people: {
        Args: never;
        Returns: {
          person_a: string;
          person_b: string;
          reason: string;
        }[];
      };
      get_integration_credentials: {
        Args: { _provider: string };
        Returns: Json;
      };
      giving_total_mismatches: {
        Args: never;
        Returns: {
          actual_lifetime: number;
          person_id: string;
          stored_lifetime: number;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_admin: { Args: never; Returns: boolean };
      normalize_external_transaction_id: {
        Args: { _value: string };
        Returns: string | null;
      };
      change_staff_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _staff_id: string;
        };
        Returns: string | null;
      };
      deactivate_staff_member: { Args: { _staff_id: string }; Returns: string | null };
      issue_acknowledgment: {
        Args: { _delivery_method?: string; _donation_id: string };
        Returns: string;
      };
      issue_tax_statement: {
        Args: {
          _delivery_method?: string;
          _person_id: string;
          _tax_year: number;
        };
        Returns: string;
      };
      lapsed_donors: {
        Args: {
          _limit?: number;
          _min_prior_years?: number;
          _min_total?: number;
          _mode?: string;
        };
        Returns: {
          email: string;
          gave_last_year: boolean;
          last_gift_amount: number;
          last_gift_date: string;
          last_gift_year: number;
          lifetime_total: number;
          name: string;
          owner: string;
          person_id: string;
          phone: string;
          prior_years: number;
          score: number;
        }[];
      };
      log_import_review_merge: {
        Args: {
          _choices?: Json;
          _existing_before: Json;
          _incoming: Json;
          _item_id: string;
          _person_id: string;
          _surviving_after: Json;
        };
        Returns: undefined;
      };
      log_review_decision: {
        Args: {
          _decision: string;
          _item_id: string;
          _person_id?: string;
          _reason?: string;
        };
        Returns: undefined;
      };
      record_import_row_failure: {
        Args: {
          _batch_id: string;
          _message: string;
          _row_data: Json;
          _row_number: number;
        };
        Returns: string;
      };
      resolve_import_row: {
        Args: {
          _activity?: Json;
          _batch_id?: string | null;
          _children?: Json;
          _contact_methods?: Json;
          _household?: Json;
          _labels?: Json;
          _person: Json;
          _provenance?: Json;
          _spouse?: Json;
        };
        Returns: Json;
      };
      resolve_review_quick_merge: {
        Args: {
          _batch_id?: string | null;
          _donation?: Json;
          _event?: Json;
          _item_id: string;
          _note?: Json;
          _person_id: string;
          _person_patch?: Json;
          _source: string;
          _traceable_fields?: string[];
        };
        Returns: Json;
      };
      resolve_review_manual_merge: {
        Args: {
          _batch_id?: string | null;
          _choices?: Json;
          _donation?: Json;
          _event?: Json;
          _existing_before?: Json;
          _incoming?: Json;
          _item_id: string;
          _note?: Json;
          _person_id: string;
          _person_patch?: Json;
          _source?: string;
          _surviving_after?: Json;
          _traceable_fields?: string[];
        };
        Returns: Json;
      };
      resolve_review_create: {
        Args: {
          _batch_id?: string | null;
          _donation?: Json;
          _event?: Json;
          _item_id: string;
          _note?: Json;
          _person: Json;
          _source?: string;
        };
        Returns: string;
      };
      resolve_review_household_card: {
        Args: { _household: Json; _members: Json };
        Returns: Json;
      };
      resolve_review_couple_activity: {
        Args: {
          _activity?: Json;
          _batch_id?: string | null;
          _item_id: string;
          _labels?: Json;
          _main: Json;
          _owner: string;
          _partner: Json;
          _row: Json;
        };
        Returns: Json;
      };
      mark_receipt_sent: {
        Args: { _donation_id: string; _sent?: boolean };
        Returns: undefined;
      };
      mark_thank_you_sent: {
        Args: { _donation_id: string; _sent?: boolean };
        Returns: undefined;
      };
      merge_households: {
        Args: {
          _field_values?: Json;
          _merged_id: string;
          _surviving_id: string;
        };
        Returns: string;
      };
      merge_people: {
        Args: {
          _field_values?: Json;
          _merged_id: string;
          _surviving_id: string;
        };
        Returns: string;
      };
      money_text: { Args: { _amount: number }; Returns: string };
      pledges_missing_payments: {
        Args: never;
        Returns: {
          amount: number;
          days_late: number;
          expected_date: string;
          frequency: string;
          last_gift_date: string;
          name: string;
          person_id: string;
          pledge_id: string;
        }[];
      };
      purge_audit_log_internal: { Args: never; Returns: number };
      purge_old_audit_log: { Args: never; Returns: number };
      recalc_all_totals_internal: { Args: never; Returns: number };
      recalc_person_totals: { Args: { _person_id: string }; Returns: undefined };
      recalculate_all_giving_totals: { Args: never; Returns: number };
      record_document_delivery: {
        Args: {
          _delivery_method: string;
          _delivery_status?: string;
          _document_id: string;
          _note?: string;
        };
        Returns: undefined;
      };
      registration_status_rank: { Args: { _status: string }; Returns: number };
      restore_records: {
        Args: { _ids: string[]; _table: string };
        Returns: number;
      };
      save_integration_credentials: {
        Args: { _credentials: Json; _primary_field: string; _provider: string };
        Returns: undefined;
      };
      search_people: {
        Args: { _limit?: number; _q: string };
        Returns: {
          person_id: string;
          reason: string;
          score: number;
        }[];
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      soundex: { Args: { "": string }; Returns: string };
      sync_primary_contact_method: {
        Args: { _person_id: string };
        Returns: undefined;
      };
      transition_review_status: {
        Args: {
          _expected_status: string;
          _item_id: string;
          _next_status: string;
          _note: string;
        };
        Returns: undefined;
      };
      tag_program_counts: {
        Args: never;
        Returns: {
          contacts: number;
          kind: string;
          label: string;
        }[];
      };
      text_soundex: { Args: { "": string }; Returns: string };
      undo_import: { Args: { _batch_id: string }; Returns: Json };
      undo_review_quick_merge: {
        Args: { _item_id: string; _person_id: string; _undo_token: Json };
        Returns: undefined;
      };
      void_tax_statement: { Args: { _document_id: string }; Returns: undefined };
    };
    Enums: {
      app_role: "admin" | "marketing" | "va";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "marketing", "va"],
    },
  },
} as const;
