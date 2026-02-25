<template>
  <section class="social-feed-view py-2 py-md-4">
    <v-row class="ga-0">
      <v-col cols="12" md="8" class="pe-md-2">
        <v-card rounded="lg" elevation="1" border class="mb-4">
          <v-card-title class="d-flex align-center flex-wrap ga-2">
            <span class="text-subtitle-1 font-weight-bold">Social feed</span>
            <v-spacer />
            <v-btn
              v-if="state.canModerate"
              size="small"
              variant="text"
              color="secondary"
              @click="actions.goToModeration"
            >
              Moderation
            </v-btn>
            <v-btn size="small" variant="outlined" :loading="state.feedQuery.isFetching" @click="actions.refreshAll">
              Refresh
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <v-alert v-if="state.actionError" type="error" variant="tonal" class="mb-3">
              {{ state.actionError }}
            </v-alert>
            <v-alert v-if="state.actionNotice" type="info" variant="tonal" class="mb-3">
              {{ state.actionNotice }}
            </v-alert>
            <v-textarea
              v-model="state.composerText"
              label="Share something"
              variant="outlined"
              rows="3"
              auto-grow
              :disabled="!state.canWrite || state.createPostMutation.isPending"
            />
            <div class="d-flex flex-wrap align-center ga-3 mt-3">
              <v-select
                v-model="state.composerVisibility"
                :items="meta.visibilityOptions"
                label="Visibility"
                variant="outlined"
                density="comfortable"
                hide-details
                :disabled="!state.canWrite || state.createPostMutation.isPending"
                style="max-width: 220px"
              />
              <v-btn
                color="primary"
                :loading="state.createPostMutation.isPending"
                :disabled="!state.canWrite || state.isBusy"
                @click="actions.submitPost"
              >
                Post
              </v-btn>
            </div>
          </v-card-text>
        </v-card>

        <v-card rounded="lg" elevation="1" border class="mb-4">
          <v-card-title class="text-subtitle-2 font-weight-bold">Find people</v-card-title>
          <v-divider />
          <v-card-text>
            <div class="d-flex flex-wrap ga-2 mb-3">
              <v-text-field
                v-model="state.followHandle"
                density="comfortable"
                variant="outlined"
                hide-details
                label="Follow by handle"
                placeholder="alice@example.social"
                class="social-compact-input"
              />
              <v-btn
                color="primary"
                variant="tonal"
                :loading="state.requestFollowMutation.isPending"
                @click="actions.followByHandle"
              >
                Follow
              </v-btn>
            </div>
            <v-text-field
              v-model="state.actorSearchText"
              density="comfortable"
              variant="outlined"
              hide-details
              label="Search actors"
              placeholder="@alice or name"
            />
            <v-list v-if="state.actorResults.length > 0" lines="two" class="mt-2">
              <v-list-item v-for="actor in state.actorResults" :key="actor.id || actor.actorUri">
                <template #title>
                  {{ meta.resolveActorName(actor) }}
                </template>
                <template #subtitle>
                  {{ actor.actorUri }}
                </template>
                <template #append>
                  <div class="d-flex ga-2">
                    <v-btn size="small" variant="text" @click="actions.followActor(actor)">Follow</v-btn>
                    <v-btn
                      v-if="actions.canStartLocalDm(actor) && state.canUseChat"
                      size="small"
                      variant="text"
                      color="secondary"
                      @click="actions.startDmForActor(actor)"
                    >
                      Message
                    </v-btn>
                  </div>
                </template>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>

        <v-card v-if="state.feedEmpty" rounded="lg" elevation="1" border>
          <v-card-text class="text-medium-emphasis">No posts yet. Create the first post for this workspace.</v-card-text>
        </v-card>

        <v-card
          v-for="post in state.feedItems"
          :key="post.id"
          rounded="lg"
          elevation="1"
          border
          class="mb-4"
        >
          <v-card-title class="d-flex align-start flex-wrap ga-2">
            <div>
              <div class="text-subtitle-2 font-weight-bold">
                {{ meta.resolveActorName(post.author) }}
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ meta.formatDateTime(post.publishedAt) }}
              </div>
            </div>
            <v-spacer />
            <v-btn
              v-if="actions.canStartLocalDm(post.author) && state.canUseChat"
              size="x-small"
              variant="text"
              color="secondary"
              @click="actions.startDmForActor(post.author)"
            >
              Message
            </v-btn>
            <v-btn size="x-small" variant="text" @click="actions.followActor(post.author)">Follow</v-btn>
            <v-btn
              v-if="state.canWrite && post.isLocal"
              size="x-small"
              variant="text"
              color="error"
              :loading="state.deletePostMutation.isPending"
              @click="actions.deletePost(post.id)"
            >
              Delete
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <p class="text-body-1 mb-2 social-post-text">{{ post.contentText || post.contentHtml }}</p>
            <div class="text-caption text-medium-emphasis mb-4">
              {{ post.replyCount || 0 }} comments · {{ post.likeCount || 0 }} likes · {{ post.announceCount || 0 }} boosts
            </div>

            <v-list density="compact" class="social-comments">
              <v-list-item v-if="!post.comments || post.comments.length < 1">
                <template #title>
                  <span class="text-caption text-medium-emphasis">No comments yet.</span>
                </template>
              </v-list-item>
              <v-list-item v-for="comment in post.comments || []" :key="comment.id">
                <template #title>
                  <span class="font-weight-medium">{{ meta.resolveActorName(comment.author) }}</span>
                </template>
                <template #subtitle>
                  <span>{{ comment.contentText || comment.contentHtml }}</span>
                </template>
                <template #append>
                  <v-btn
                    v-if="state.canWrite && comment.isLocal"
                    size="x-small"
                    variant="text"
                    color="error"
                    :loading="state.deleteCommentMutation.isPending"
                    @click="actions.deleteComment(comment.id)"
                  >
                    Delete
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>

            <div class="d-flex flex-wrap ga-2 mt-3">
              <v-text-field
                v-model="state.commentDrafts[String(post.id)]"
                density="comfortable"
                hide-details
                variant="outlined"
                label="Write a comment"
                :disabled="!state.canWrite || state.createCommentMutation.isPending"
              />
              <v-btn
                color="primary"
                variant="tonal"
                :loading="state.createCommentMutation.isPending"
                :disabled="!state.canWrite"
                @click="actions.submitComment(post.id)"
              >
                Comment
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4" class="ps-md-2">
        <v-card rounded="lg" elevation="1" border>
          <v-card-title class="d-flex align-center ga-2">
            <span class="text-subtitle-2 font-weight-bold">Notifications</span>
            <v-spacer />
            <v-btn
              size="x-small"
              variant="text"
              :loading="state.markNotificationsReadMutation.isPending"
              @click="actions.markAllNotificationsRead"
            >
              Mark all read
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <v-list density="comfortable">
              <v-list-item v-if="state.notifications.length < 1">
                <template #title>
                  <span class="text-caption text-medium-emphasis">No notifications.</span>
                </template>
              </v-list-item>
              <v-list-item v-for="entry in state.notifications" :key="entry.id">
                <template #title>
                  {{ entry.type || "notification" }}
                </template>
                <template #subtitle>
                  {{ meta.formatDateTime(entry.createdAt) }}
                </template>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </section>
</template>

<script setup>
import { useSocialFeedView } from "./useSocialFeedView.js";

const { meta, state, actions } = useSocialFeedView();
</script>

<style scoped>
.social-feed-view {
  width: 100%;
}

.social-compact-input {
  min-width: 260px;
  flex: 1 1 280px;
}

.social-post-text {
  white-space: pre-wrap;
}

.social-comments {
  border: 1px solid rgba(54, 66, 58, 0.12);
  border-radius: 10px;
}
</style>
