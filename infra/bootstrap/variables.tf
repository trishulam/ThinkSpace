variable "project_id" {
  description = "GCP project ID that will host the Terraform state bucket."
  type        = string
}

variable "region" {
  description = "Default GCP region for bootstrap resources."
  type        = string
  default     = "asia-south1"
}

variable "state_bucket_name" {
  description = "Globally unique GCS bucket name for Terraform remote state."
  type        = string
}

variable "labels" {
  description = "Optional labels applied to bootstrap resources."
  type        = map(string)
  default = {
    app         = "thinkspace"
    environment = "bootstrap"
    managed_by  = "terraform"
  }
}
