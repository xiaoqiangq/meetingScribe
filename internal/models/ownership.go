package models

import "context"

type requestOwnerKey struct{}

func WithRequestOwner(ctx context.Context, id uint) context.Context {
	return context.WithValue(ctx, requestOwnerKey{}, id)
}
func RequestOwner(ctx context.Context) (uint, bool) {
	id, ok := ctx.Value(requestOwnerKey{}).(uint)
	return id, ok
}
