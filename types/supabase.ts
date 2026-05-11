export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      athletes: {
        Row: {
          id: string;
          name: string;
          email: string | null;
          level: string;
          swim_background: string;
          bike_background: string;
          run_background: string;
          goal_race_date: string | null;
          goal_race_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email?: string | null;
          level: string;
          swim_background?: string;
          bike_background?: string;
          run_background?: string;
          goal_race_date?: string | null;
          goal_race_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string | null;
          level?: string;
          swim_background?: string;
          bike_background?: string;
          run_background?: string;
          goal_race_date?: string | null;
          goal_race_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          athlete_id: string;
          name: string;
          phase: string | null;
          start_date: string;
          end_date: string | null;
          total_weeks: number | null;
          status: string | null;
        };
        Insert: {
          id?: string;
          athlete_id: string;
          name: string;
          phase?: string | null;
          start_date: string;
          end_date?: string | null;
          total_weeks?: number | null;
          status?: string | null;
        };
        Update: {
          id?: string;
          athlete_id?: string;
          name?: string;
          phase?: string | null;
          start_date?: string;
          end_date?: string | null;
          total_weeks?: number | null;
          status?: string | null;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          plan_id: string;
          athlete_id: string;
          title: string;
          sport: string;
          scheduled_date: string;
          duration_mins: number | null;
          distance: number | null;
          distance_unit: string | null;
          intensity: string | null;
          description: string | null;
          coach_note: string | null;
          status: string | null;
          completed_at: string | null;
          week_number: number | null;
          phase: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          athlete_id: string;
          title: string;
          sport: string;
          scheduled_date: string;
          duration_mins?: number | null;
          distance?: number | null;
          distance_unit?: string | null;
          intensity?: string | null;
          description?: string | null;
          coach_note?: string | null;
          status?: string | null;
          completed_at?: string | null;
          week_number?: number | null;
          phase?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          athlete_id?: string;
          title?: string;
          sport?: string;
          scheduled_date?: string;
          duration_mins?: number | null;
          distance?: number | null;
          distance_unit?: string | null;
          intensity?: string | null;
          description?: string | null;
          coach_note?: string | null;
          status?: string | null;
          completed_at?: string | null;
          week_number?: number | null;
          phase?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_logs_session_id_fkey';
            columns: ['id'];
            isOneToOne: false;
            referencedRelation: 'session_logs';
            referencedColumns: ['session_id'];
          },
        ];
      };
      session_blocks: {
        Row: {
          id: string;
          session_id: string;
          block_type: string;
          title: string;
          order_index: number;
        };
        Insert: {
          id?: string;
          session_id: string;
          block_type: string;
          title: string;
          order_index: number;
        };
        Update: {
          id?: string;
          session_id?: string;
          block_type?: string;
          title?: string;
          order_index?: number;
        };
        Relationships: [];
      };
      session_steps: {
        Row: {
          id: string;
          block_id: string;
          step_text: string;
          order_index: number;
          is_checked: boolean;
        };
        Insert: {
          id?: string;
          block_id: string;
          step_text: string;
          order_index: number;
          is_checked?: boolean;
        };
        Update: {
          id?: string;
          block_id?: string;
          step_text?: string;
          order_index?: number;
          is_checked?: boolean;
        };
        Relationships: [];
      };
      session_logs: {
        Row: {
          id: string;
          session_id: string;
          athlete_id: string;
          completed_at: string;
          actual_duration_mins: number | null;
          actual_distance: number | null;
          avg_heart_rate: number | null;
          rpe: number | null;
          notes: string | null;
          media_uris: Json | null;
          source: string | null;
          external_workout_id: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          athlete_id: string;
          completed_at: string;
          actual_duration_mins?: number | null;
          actual_distance?: number | null;
          avg_heart_rate?: number | null;
          rpe?: number | null;
          notes?: string | null;
          media_uris?: Json | null;
          source?: string | null;
          external_workout_id?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          athlete_id?: string;
          completed_at?: string;
          actual_duration_mins?: number | null;
          actual_distance?: number | null;
          avg_heart_rate?: number | null;
          rpe?: number | null;
          notes?: string | null;
          media_uris?: Json | null;
          source?: string | null;
          external_workout_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'session_logs_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      personal_bests: {
        Row: {
          id: string;
          athlete_id: string;
          sport: string;
          distance: number;
          distance_unit: string;
          time_mins: number;
          achieved_date: string;
          source: string;
          session_log_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          athlete_id: string;
          sport: string;
          distance: number;
          distance_unit: string;
          time_mins: number;
          achieved_date: string;
          source: string;
          session_log_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          athlete_id?: string;
          sport?: string;
          distance?: number;
          distance_unit?: string;
          time_mins?: number;
          achieved_date?: string;
          source?: string;
          session_log_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      race_events: {
        Row: {
          id: string;
          athlete_id: string | null;
          name: string;
          date: string;
          distance: string;
          is_a_race: boolean;
          notes: string | null;
          priority: string;
          race_type: string | null;
        };
        Insert: {
          id?: string;
          athlete_id?: string | null;
          name: string;
          date: string;
          distance: string;
          is_a_race?: boolean;
          notes?: string | null;
          priority?: string;
          race_type?: string | null;
        };
        Update: {
          id?: string;
          athlete_id?: string | null;
          name?: string;
          date?: string;
          distance?: string;
          is_a_race?: boolean;
          notes?: string | null;
          priority?: string;
          race_type?: string | null;
        };
        Relationships: [];
      };
      rova_challenges: {
        Row: {
          id: string;
          athlete_id: string;
          challenge_type: string;
          title: string;
          description: string;
          scheduled_date: string;
          status: string;
          accepted_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          athlete_id: string;
          challenge_type: string;
          title: string;
          description: string;
          scheduled_date: string;
          status?: string;
          accepted_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          athlete_id?: string;
          challenge_type?: string;
          title?: string;
          description?: string;
          scheduled_date?: string;
          status?: string;
          accepted_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      flex_history: {
        Row: {
          id: string;
          athlete_id: string;
          week_start_date: string;
          reason: string;
          reason_detail: string | null;
          override_limit: boolean;
          ai_status: string;
          moved_count: number;
          dropped_count: number;
          original_snapshot: Json;
          reshuffled_snapshot: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          athlete_id: string;
          week_start_date: string;
          reason: string;
          reason_detail?: string | null;
          override_limit?: boolean;
          ai_status?: string;
          moved_count?: number;
          dropped_count?: number;
          original_snapshot?: Json;
          reshuffled_snapshot?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          athlete_id?: string;
          week_start_date?: string;
          reason?: string;
          reason_detail?: string | null;
          override_limit?: boolean;
          ai_status?: string;
          moved_count?: number;
          dropped_count?: number;
          original_snapshot?: Json;
          reshuffled_snapshot?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      race_goals: {
        Row: {
          id: string;
          athlete_id: string;
          title: string;
          event_date: string;
          priority: string;
          race_type: string | null;
          goal_swim_time: string | null;
          goal_bike_time: string | null;
          goal_run_time: string | null;
          goal_overall_time: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          athlete_id: string;
          title: string;
          event_date: string;
          priority?: string;
          race_type?: string | null;
          goal_swim_time?: string | null;
          goal_bike_time?: string | null;
          goal_run_time?: string | null;
          goal_overall_time?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          athlete_id?: string;
          title?: string;
          event_date?: string;
          priority?: string;
          race_type?: string | null;
          goal_swim_time?: string | null;
          goal_bike_time?: string | null;
          goal_run_time?: string | null;
          goal_overall_time?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      rova_conversations: {
        Row: {
          id: string;
          athlete_id: string;
          role: string;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          athlete_id: string;
          role: string;
          message: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          athlete_id?: string;
          role?: string;
          message?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
  };
};

