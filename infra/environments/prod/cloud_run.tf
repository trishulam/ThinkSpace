locals {
  default_backend_image  = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repository_id}/backend:latest"
  default_frontend_image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repository_id}/frontend:latest"
  backend_image_ref      = coalesce(var.backend_image, local.default_backend_image)
  frontend_image_ref     = coalesce(var.frontend_image, local.default_frontend_image)
}

resource "google_cloud_run_v2_service" "backend" {
  project             = var.project_id
  name                = var.backend_service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  lifecycle {
    ignore_changes = [scaling]
  }

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = var.backend_timeout
    max_instance_request_concurrency = var.backend_max_instance_request_concurrency

    scaling {
      min_instance_count = var.backend_min_instance_count
      max_instance_count = var.backend_max_instance_count
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [google_sql_database_instance.adk.connection_name]
      }
    }

    containers {
      image = local.backend_image_ref

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.backend_cpu
          memory = var.backend_memory
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "THINKSPACE_SESSION_STORE_BACKEND"
        value = "firestore"
      }

      env {
        name  = "THINKSPACE_ADK_SESSION_BACKEND"
        value = "database"
      }

      env {
        name  = "THINKSPACE_GCS_BUCKET"
        value = google_storage_bucket.session_artifacts.name
      }

      env {
        name  = "THINKSPACE_FIRESTORE_DATABASE_ID"
        value = var.firestore_database_id
      }

      env {
        name  = "THINKSPACE_FIRESTORE_COLLECTION_PREFIX"
        value = var.thinkspace_firestore_collection_prefix
      }

      env {
        name  = "THINKSPACE_AGENT_MODEL"
        value = var.thinkspace_agent_model
      }

      env {
        name  = "THINKSPACE_FLASHCARD_MODEL"
        value = var.thinkspace_flashcard_model
      }

      env {
        name  = "THINKSPACE_KEY_MOMENT_MODEL"
        value = var.thinkspace_key_moment_model
      }

      env {
        name  = "THINKSPACE_CANVAS_VISUAL_PLANNER_MODEL"
        value = var.thinkspace_canvas_visual_planner_model
      }

      env {
        name  = "THINKSPACE_CANVAS_VISUAL_IMAGE_MODEL"
        value = var.thinkspace_canvas_visual_image_model
      }

      env {
        name  = "THINKSPACE_ADK_DATABASE_INSTANCE_CONNECTION_NAME"
        value = google_sql_database_instance.adk.connection_name
      }

      env {
        name  = "THINKSPACE_ADK_DATABASE_NAME"
        value = google_sql_database.adk.name
      }

      env {
        name  = "THINKSPACE_ADK_DATABASE_USER"
        value = google_sql_user.adk.name
      }

      env {
        name  = "THINKSPACE_ADK_DATABASE_SOCKET_DIR"
        value = "/cloudsql"
      }

      env {
        name = "GOOGLE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_api_key.secret_id
            version = var.google_api_key_secret_version
          }
        }
      }

      env {
        name = "THINKSPACE_ADK_DATABASE_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret.db_password,
    google_sql_database_instance.adk,
  ]
}

resource "google_cloud_run_v2_service" "frontend" {
  project             = var.project_id
  name                = var.frontend_service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  lifecycle {
    ignore_changes = [scaling]
  }

  template {
    timeout                          = var.frontend_timeout
    max_instance_request_concurrency = var.frontend_max_instance_request_concurrency

    scaling {
      min_instance_count = var.frontend_min_instance_count
      max_instance_count = var.frontend_max_instance_count
    }

    containers {
      image = local.frontend_image_ref

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.frontend_cpu
          memory = var.frontend_memory
        }
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_artifact_registry_repository.containers,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.frontend.location
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
